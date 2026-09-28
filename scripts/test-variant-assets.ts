import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyMissingCharacterAsset,
  collectCharacterAssetCandidates,
  filterRuntimeCharacterSkins,
} from "./character-assets";
import { loadCatalogSource } from "./catalog-source";
import { collectNeeded } from "./sync-assets";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sourceCharacter = {
  id: "9912",
  baseId: "9912",
  names: {
    "zh-CN": "Fixture",
    "zh-TW": "Fixture",
    "en-US": "Fixture",
    "ja-JP": "Fixture",
    "ko-KR": "Fixture",
  },
  rarity: 5,
  maxInsight: 3,
  defaultVariant: "991201",
  glReleased: false,
  skins: [
    { id: "991201", type: "default" as const },
    { id: "991202", type: "insight" as const, name: "Insight" },
    {
      id: "991234567",
      type: "skin" as const,
      name: "Source-only Skin",
      nameEn: "Source-only Skin",
      glPresent: false,
    },
  ],
};

const source = {
  schemaVersion: 3 as const,
  sourceHashes: {},
  characters: [sourceCharacter],
  psychubes: [{
    id: "2001",
    names: {
      "zh-CN": "Fixture Psychube",
      "zh-TW": "Fixture Psychube",
      "en-US": "Fixture Psychube",
      "ja-JP": "Fixture Psychube",
      "ko-KR": "Fixture Psychube",
    },
    rarity: 5,
    glPresent: true,
  }],
};

const candidates = collectCharacterAssetCandidates(source.characters);
assert.deepEqual(
  candidates.map((candidate) => candidate.id),
  ["991201", "991202", "991234567"],
  "asset candidates come from catalog source, including arbitrary-width Skin IDs",
);
assert.deepEqual(
  collectNeeded(source).characters.map((candidate) => candidate.id),
  ["991201", "991202", "991234567"],
  "sync-assets discovers candidates from source rather than generated runtime output",
);

assert.equal(
  classifyMissingCharacterAsset({ type: "skin" }, false, false),
  "skip",
  "source-only Skin is optional",
);
assert.equal(
  classifyMissingCharacterAsset({ type: "skin" }, false, true),
  "retain",
  "a trusted prior Skin WebP is retained",
);
for (const type of ["default", "insight"] as const) {
  assert.equal(
    classifyMissingCharacterAsset({ type }, false, false),
    "fatal",
    `missing ${type} remains fatal without a prior WebP`,
  );
}

const installedBeforeSkin = new Set(["991201", "991202"]);
const runtimeBeforeSkin = filterRuntimeCharacterSkins(
  sourceCharacter.skins,
  installedBeforeSkin,
);
assert.deepEqual(
  runtimeBeforeSkin.map((skin) => skin.id),
  ["991201", "991202"],
  "runtime omits a Skin without an installed WebP",
);
const runtimeAfterSkin = filterRuntimeCharacterSkins(
  sourceCharacter.skins,
  new Set([...installedBeforeSkin, "991234567"]),
);
assert.deepEqual(
  runtimeAfterSkin.map((skin) => skin.id),
  ["991201", "991202", "991234567"],
  "a later source PNG makes the Skin effective automatically",
);
assert.throws(
  () => filterRuntimeCharacterSkins(sourceCharacter.skins, new Set(["991201"])),
  /Required character Variant asset missing: 991202/,
  "missing default/insight assets are not silently omitted",
);

const catalog = loadCatalogSource();
const catalogCandidates = collectCharacterAssetCandidates(catalog.characters);
for (const id of ["30660001", "30880001"]) {
  assert.ok(
    catalogCandidates.some((candidate) => candidate.id === id && candidate.type === "skin"),
    `${id} remains a Skin candidate in catalog source`,
  );
}
const missingManifest = JSON.parse(
  readFileSync(path.join(ROOT, "scripts/data/missing-assets.json"), "utf-8"),
) as unknown[];
assert.ok(
  !missingManifest.includes("30660001") && !missingManifest.includes("30880001"),
  "source-only Skin IDs are not added to missing-assets.json",
);

console.log("variant asset regressions: passed");
