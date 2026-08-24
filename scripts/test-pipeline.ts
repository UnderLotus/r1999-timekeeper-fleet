import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { characters } from "../src/data/characters";
import { psychubes } from "../src/data/psychubes";
import {
  parseReleaseOrderSources,
  recalculateReleaseOrder,
  type ReleaseOrderSources,
} from "./recalculate-order";
import type { CharacterEntry } from "./types";
import { exactAssetPaths } from "./asset-source";
import {
  assertKnownCatalogPolicy,
  loadCatalogPolicy,
  parseCatalogPolicy,
} from "./catalog-policy";
import { parseHuijiCards } from "./sync-release-order";
import { completeCatalogNames } from "./extract-catalog-source";
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
check(
  "release order rejects numeric IDs instead of silently changing tiers",
  throws(() => parseReleaseOrderSources({ huiji: [3156], kornblume: [] })),
);
check(
  "release order rejects malformed source metadata",
  throws(() =>
    parseReleaseOrderSources({ source: 1, huiji: ["3156"], kornblume: [] }),
  ),
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
check(
  "catalog character IDs are unique",
  new Set(characters.map((entry) => entry.id)).size === characters.length,
);
const skins = characters.flatMap((entry) => entry.skins);
check(
  "catalog skin IDs are unique",
  new Set(skins.map((skin) => skin.id)).size === skins.length,
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
  "catalog psychube IDs are unique",
  new Set(psychubes.map((entry) => entry.id)).size === psychubes.length,
);
check(
  "CB discarded character Schneider is excluded",
  !characters.some((entry) => entry.baseId === "3029"),
);
check(
  "The Twins keeps data-driven dual psychube capability",
  (() => {
    const twins = characters.find((entry) => entry.id === "3149");
    return (
      twins?.psychubeSlots === 2 &&
      JSON.stringify(twins.exclusivePsychubeIds) ===
        JSON.stringify(["1571", "1572"])
    );
  })(),
);
check(
  "Gluttony and Greed upgrade materials are excluded",
  !psychubes.some((entry) => entry.id === "1000" || entry.id === "1001"),
);
const policy = loadCatalogPolicy(
  path.join(ROOT, "scripts/data/catalog-policy.json"),
);
check(
  "catalog policy keeps exclusions and capabilities out of builder constants",
  policy.excludedCharacters.some((entry) => entry.baseId === "3029") &&
    policy.excludedPsychubes.some((entry) => entry.id === "1000") &&
    policy.characterCapabilities.some((entry) => entry.baseId === "3149"),
);
check(
  "catalog policy duplicate IDs fail loudly",
  throws(() =>
    parseCatalogPolicy({
      excludedCharacters: [
        { baseId: "1", reason: "a" },
        { baseId: "1", reason: "b" },
      ],
      excludedPsychubes: [],
      characterCapabilities: [],
    }),
  ),
);
check(
  "catalog policy stale targets fail loudly",
  throws(() =>
    assertKnownCatalogPolicy(policy, new Set(["1"]), new Set(["2"])),
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
  "Huiji markdown parser derives ordered base IDs",
  JSON.stringify(
    parseHuijiCards(
      '[![Image: Headicon large-315601.png](x)](https://res1999.huijiwiki.com/wiki/a "A")\n[![Image: Headicon large-314901.png](x)](https://res1999.huijiwiki.com/wiki/b "B")',
    ).map((entry) => entry.baseId),
  ) === JSON.stringify(["3156", "3149"]),
);
check(
  "Huiji parser uses keep-last dedupe like roster updater",
  JSON.stringify(
    parseHuijiCards(
      '[![Image: Headicon large-315601.png](x)](https://res1999.huijiwiki.com/wiki/a "A")\n' +
        '[![Image: Headicon large-314901.png](x)](https://res1999.huijiwiki.com/wiki/b "B")\n' +
        '[![Image: Headicon large-315602.png](x)](https://res1999.huijiwiki.com/wiki/a2 "A2")',
    ).map((entry) => entry.baseId),
  ) === JSON.stringify(["3149", "3156"]),
);
const syntheticCnOnlyPsychube = {
  glPresent: false,
  names: completeCatalogNames("简体名称", "English fallback", {}),
};
check(
  "CN-only psychube locale fallback uses English instead of Simplified Chinese",
  !syntheticCnOnlyPsychube.glPresent &&
    (["zh-TW", "ja-JP", "ko-KR"] as const).every(
      (locale) =>
        syntheticCnOnlyPsychube.names[locale] ===
          syntheticCnOnlyPsychube.names["en-US"] &&
        syntheticCnOnlyPsychube.names[locale] !==
          syntheticCnOnlyPsychube.names["zh-CN"],
    ),
);
console.log(`\npipeline tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
