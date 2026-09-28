import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { characters } from "../src/data/characters";
import { psychubes } from "../src/data/psychubes";
import {
  parseReleaseOrderSources,
  recalculateReleaseOrder,
  type ReleaseOrderSources,
} from "./recalculate-order";
import type { CnPackageSkin } from "./catalog-composition";
import {
  computeUnmappedCnSkins,
  DEFAULT_MAPPING_DIFF_FILE,
  mappingDiffFile,
  persistMappingDiff,
  reportUnmappedCnSkins,
} from "./skin-mapping-diff";
import type { CharacterEntry } from "./types";
import type { ArcanistEntryFull } from "./skin-utils";
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
function thrownMessage(run: () => void): string {
  try {
    run();
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
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
    policy.characterCapabilities.some((entry) => entry.baseId === "3149") &&
    policy.preservedCharacterAssets.some((entry) => entry.id === "312503"),
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
      preservedCharacterAssets: [],
      ignoredCnSkinStubs: [],
    }),
  ),
);
check(
  "catalog policy duplicate preserved asset IDs fail loudly",
  throws(() =>
    parseCatalogPolicy({
      excludedCharacters: [],
      excludedPsychubes: [],
      characterCapabilities: [],
      preservedCharacterAssets: [
        { id: "312503", reason: "a" },
        { id: "312503", reason: "b" },
      ],
      ignoredCnSkinStubs: [],
    }),
  ),
);
check(
  "catalog policy duplicate CN skin stub IDs fail loudly",
  throws(() =>
    parseCatalogPolicy({
      excludedCharacters: [],
      excludedPsychubes: [],
      characterCapabilities: [],
      preservedCharacterAssets: [],
      ignoredCnSkinStubs: [
        { id: "300304", reason: "a" },
        { id: "300304", reason: "b" },
      ],
    }),
  ),
);
check(
  "catalog policy stale preserved asset targets fail loudly",
  throws(() =>
    assertKnownCatalogPolicy(
      policy,
      new Set(["3029", "3149"]),
      new Set(["1000", "1001", "1571", "1572"]),
      new Set(),
    ),
  ),
);
check(
  "catalog policy stale CN skin stub targets fail loudly",
  (() => {
    // 完整涵蓋 policy 的五個 stub，僅 303402 從 CN 包體集合移除。
    const cnSkins = new Set([
      "300301",
      "300304",
      "302302",
      "302511",
      "302811",
      "308005",
    ]);
    const message = thrownMessage(() =>
      assertKnownCatalogPolicy(
        policy,
        new Set(["3029", "3149"]),
        new Set(["1000", "1001", "1571", "1572"]),
        new Set(["312503"]),
        cnSkins,
      ),
    );
    return (
      message === "Catalog policy references unknown CN skin stub: 303402"
    );
  })(),
);
check(
  "catalog policy rejects a stub once ArcanistMap lists it",
  (() => {
    const cnSkins = new Set([
      "300301",
      "300304",
      "302302",
      "302511",
      "302811",
      "303402",
      "308005",
    ]);
    // baseline：所有 stub 皆未被 live2d 收錄，必須通過
    assertKnownCatalogPolicy(
      policy,
      new Set(["3029", "3149"]),
      new Set(["1000", "1001", "1571", "1572"]),
      new Set(["312503"]),
      cnSkins,
    );
    const message = thrownMessage(() =>
      assertKnownCatalogPolicy(
        policy,
        new Set(["3029", "3149"]),
        new Set(["1000", "1001", "1571", "1572"]),
        new Set(["312503", "300304"]),
        cnSkins,
      ),
    );
    return (
      message ===
      "CN skin stub 300304 is now listed in ArcanistMap; remove the stale exclusion"
    );
  })(),
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
  "unmapped CN skin diff deduplicates and sorts by ID",
  (() => {
    const arcanists: ArcanistEntryFull[] = [
      {
        id: 3003,
        name: "Mistletoe",
        nameEng: "Mistletoe",
        live2d: [],
      },
      {
        id: 3080,
        name: "Kakania",
        nameEng: "Kakania",
        live2d: [],
      },
    ];
    const diff = computeUnmappedCnSkins(
      [
        { id: 308005, characterId: 3080 },
        { id: 300304, characterId: 3003 },
        { id: 308005, characterId: 3080 },
        { id: 300304, characterId: 3003 },
      ],
      arcanists,
    );
    return (
      diff.length === 2 &&
      diff[0].id === "300304" &&
      diff[1].id === "308005"
    );
  })(),
);
check(
  "each sync run targets its own mapping diff file, never a stale one",
  (() => {
    const previous = process.env.R1999_MAPPING_DIFF_FILE;
    try {
      process.env.R1999_MAPPING_DIFF_FILE = "/tmp/r1999-team-list-sync/run-fixture.json";
      if (mappingDiffFile() !== "/tmp/r1999-team-list-sync/run-fixture.json")
        return false;
      delete process.env.R1999_MAPPING_DIFF_FILE;
      return mappingDiffFile() === DEFAULT_MAPPING_DIFF_FILE;
    } finally {
      if (previous === undefined) delete process.env.R1999_MAPPING_DIFF_FILE;
      else process.env.R1999_MAPPING_DIFF_FILE = previous;
    }
  })(),
);
check(
  "mapping diff persistence failures never throw the reminder path",
  (() => {
    const tmp = mkdtempSync(path.join(tmpdir(), "r1999-mapping-diff-"));
    try {
      const okFile = path.join(tmp, "diff.json");
      const persisted = persistMappingDiff(
        [{ id: "308005", baseId: "3080", name: "Kakania" }],
        okFile,
      );
      const blockedFile = path.join(tmp, "occupied", "nested", "diff.json");
      writeFileSync(path.join(tmp, "occupied"), "not a directory");
      const failed = persistMappingDiff(
        [{ id: "308005", baseId: "3080", name: "Kakania" }],
        blockedFile,
      );
      let reported = true;
      try {
        reportUnmappedCnSkins(
          [{ id: "308005", baseId: "3080", name: "Kakania" }],
          failed ? okFile : null,
        );
      } catch {
        reported = false;
      }
      return (
        persisted &&
        JSON.parse(readFileSync(okFile, "utf-8")).diff.length === 1 &&
        !failed &&
        reported
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  })(),
);
check(
  "direct Huiji card parser preserves order",
  JSON.stringify(
    parseHuijiCards(
      JSON.stringify([
        { id: 315601, baseId: "3156", name: "A", href: "https://res1999.huijiwiki.com/wiki/a" },
        { id: 314901, baseId: "3149", name: "B", href: "https://res1999.huijiwiki.com/wiki/b" },
      ]),
    ).map((entry) => entry.baseId),
  ) === JSON.stringify(["3156", "3149"]),
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
