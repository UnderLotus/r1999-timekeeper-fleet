import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { characters } from "../src/data/characters";
import { psychubes } from "../src/data/psychubes";
import {
  parseReleaseOrderSources,
  recalculateReleaseOrder,
  type ReleaseOrderSources,
} from "./recalculate-order";
import type { CnPackageSkin } from "./catalog-composition";
import { computeUnmappedCnSkins } from "./skin-mapping-diff";
import type { CharacterEntry } from "./types";
import type { ArcanistEntryFull } from "./skin-utils";
import { exactAssetPaths } from "./asset-source";
import {
  assertKnownCatalogPolicy,
  parseCatalogPolicy,
  type CatalogPolicy,
} from "./catalog-policy";
import { parseHuijiCards } from "./sync-release-order";
import { loadCatalogSource } from "./catalog-source";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0,
  fail = 0;
function throws(run: () => void): boolean {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}
function check(name: string, value: boolean, detail = ""): void {
  if (value) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const sources = JSON.parse(
  readFileSync(path.join(ROOT, "scripts/data/release-order.json"), "utf-8"),
) as ReleaseOrderSources;
const catalogSource = loadCatalogSource();
const sourceCharacterNames = new Map(
  catalogSource.characters.map((entry) => [entry.baseId, entry.names]),
);
const sourcePsychubeNames = new Map(
  catalogSource.psychubes.map((entry) => [entry.id, entry.names]),
);
check(
  "builders transmit source locale names without refilling a missing locale",
  characters.every(
    (entry) =>
      isDeepStrictEqual(entry.names, sourceCharacterNames.get(entry.baseId)),
  ) &&
    psychubes.every(
      (entry) =>
        isDeepStrictEqual(entry.names, sourcePsychubeNames.get(entry.id)),
    ),
);
check(
  "release order rejects numeric IDs instead of silently changing tiers",
  throws(() => parseReleaseOrderSources({ huiji: [3156], kornblume: [] })),
);
const first = recalculateReleaseOrder(
  JSON.parse(JSON.stringify(characters)) as CharacterEntry[],
  sources,
);
const second = recalculateReleaseOrder(
  JSON.parse(JSON.stringify(first)) as CharacterEntry[],
  sources,
);
check(
  "release order is idempotent",
  JSON.stringify(first.map((entry) => entry.id)) ===
    JSON.stringify(second.map((entry) => entry.id)),
);
check(
  "release order is contiguous and 1-based",
  first.every((entry, index) => entry.releaseOrder === index + 1),
);
check(
  "Huiji snapshot IDs exist in current catalog",
  sources.huiji.every((id) => characters.some((entry) => entry.baseId === id)),
);

const compactSkins = catalogSource.characters.flatMap(
  (character) => character.skins,
);
check(
  "compact source records validated Global presence only for garment skins",
  catalogSource.schemaVersion === 3 &&
    typeof catalogSource.sourceHashes["gl/skin.json"] === "string" &&
    compactSkins.every((skin) =>
      skin.type === "skin"
        ? typeof skin.glPresent === "boolean"
        : !("glPresent" in skin),
    ),
);
check(
  "CB discarded character Schneider is excluded",
  !characters.some((entry) => entry.baseId === "3029"),
);
const emptyPolicy: CatalogPolicy = {
  excludedCharacters: [],
  excludedPsychubes: [],
  characterCapabilities: [],
  preservedCharacterAssets: [],
  ignoredCnSkinStubs: [],
};
check(
  "catalog policy duplicate IDs fail loudly",
  throws(() =>
    parseCatalogPolicy({
      ...emptyPolicy,
      excludedCharacters: [
        { baseId: "1", reason: "a" },
        { baseId: "1", reason: "b" },
      ],
    }),
  ),
);
check(
  "catalog policy stale targets fail loudly",
  throws(() =>
    assertKnownCatalogPolicy(
      {
        ...emptyPolicy,
        preservedCharacterAssets: [{ id: "999999", reason: "fixture" }],
      },
      new Set(),
      new Set(),
      new Set(),
    ),
  ),
);
const exactPaths = exactAssetPaths(
  characters.flatMap((entry) => entry.skins.map((skin) => skin.id)),
  psychubes.map((entry) => entry.id),
);
check(
  "asset acquisition allowlist contains exact files only",
  exactPaths.length ===
    characters.flatMap((entry) => entry.skins).length + psychubes.length &&
    exactPaths.every((file) =>
      /^singlebg\/(headicon_small|equip_defaulticon)\/\d+\.png$/.test(file),
    ),
);
check(
  "unmapped CN skins produce a reminder without failing the pipeline",
  (() => {
    const arcanists: ArcanistEntryFull[] = [
      {
        id: 3080,
        name: "Kakania",
        nameEng: "Kakania",
        live2d: [
          {
            id: 308001,
            name: "",
            nameEng: "",
            des: "",
            characterSkin: "",
            characterSkinNameEng: "",
          },
        ],
      },
      { id: 9999, name: "Excluded", nameEng: "Excluded", live2d: [] },
    ];
    const cnSkins: CnPackageSkin[] = [
      { id: 308001, characterId: 3080 },
      { id: 308005, characterId: 3080 },
      { id: 700101, characterId: 0 },
    ];
    const diff = computeUnmappedCnSkins(cnSkins, arcanists);
    const filtered = computeUnmappedCnSkins(cnSkins, arcanists, new Set(["308005"]));
    return (
      diff.length === 1 &&
      diff[0].id === "308005" &&
      diff[0].baseId === "3080" &&
      diff[0].name === "Kakania" &&
      filtered.length === 0
    );
  })(),
);
check(
  "CN characterId, not Variant width, identifies a new unmapped owner",
  (() => {
    const arcanists: ArcanistEntryFull[] = [
      { id: 3066, name: "37", nameEng: "Thirty-seven", live2d: [] },
    ];
    const diff = computeUnmappedCnSkins(
      [{ id: 30660001, characterId: 3066 }],
      arcanists,
    );
    return diff.length === 1 && diff[0].baseId === "3066";
  })(),
);
check(
  "direct Huiji parser keeps the last duplicate character card",
  JSON.stringify(
    parseHuijiCards(
      JSON.stringify([
        { id: 315601, baseId: "3156", name: "A", href: "https://res1999.huijiwiki.com/wiki/a" },
        { id: 314901, baseId: "3149", name: "B", href: "https://res1999.huijiwiki.com/wiki/b" },
        { id: 315602, baseId: "3156", name: "A2", href: "https://res1999.huijiwiki.com/wiki/a2" },
      ]),
    ).map((entry) => entry.baseId),
  ) === JSON.stringify(["3149", "3156"]),
);
console.log(`\npipeline tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
