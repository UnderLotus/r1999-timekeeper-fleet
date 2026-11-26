import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { exactAssetPaths } from "../../scripts/asset-source";
import { loadCatalogPolicy } from "../../scripts/catalog-policy";
import { loadCatalogSource } from "../../scripts/catalog-source";
import { loadGeneratedCatalog } from "../../scripts/generated-catalog";
import { parseReleaseOrderSources } from "../../scripts/recalculate-order";
import {
  indexReleaseOverrides,
  parseReleaseOverrides,
  resolveSkinRelease,
} from "../../scripts/release-status";
import type { CharacterDef, PsychubeDef } from "../../src/types/catalog";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LANGS = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const;

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, relative), "utf-8")) as T;
}

describe("committed catalog integrity", () => {
  const charsFile = path.join(ROOT, "src/data/characters.ts");
  const psychubesFile = path.join(ROOT, "src/data/psychubes.ts");
  assert.ok(
    existsSync(charsFile) && existsSync(psychubesFile),
    "generated catalogs missing; run build:characters / build:psychubes",
  );

  const characters = loadGeneratedCatalog<CharacterDef>(charsFile);
  const psychubes = loadGeneratedCatalog<PsychubeDef>(psychubesFile);
  const source = loadCatalogSource();
  const policy = loadCatalogPolicy(
    path.join(ROOT, "scripts/data/catalog-policy.json"),
  );

  it("keeps non-empty, unique character, psychube, and variant IDs with valid locale fields", () => {
    assert.ok(characters.length > 0);
    assert.ok(psychubes.length > 0);

    for (const [kind, rows] of [
      ["character", characters],
      ["psychube", psychubes],
    ] as const) {
      const ids = rows.map((entry) => entry.id);
      const dupes = ids.filter((id, index) => !id || ids.indexOf(id) !== index);
      assert.deepEqual(dupes, [], `invalid/duplicate ${kind} IDs`);

      const badNames = rows
        .filter((entry) => {
          const names = entry.names as Record<string, unknown>;
          return (
            typeof names["zh-CN"] !== "string" ||
            Object.entries(names).some(
              ([lang, value]) =>
                !LANGS.includes(lang as (typeof LANGS)[number]) ||
                typeof value !== "string" ||
                !value.trim(),
            )
          );
        })
        .map((entry) => entry.id);
      assert.deepEqual(badNames, [], `invalid ${kind} names`);
    }

    const variantIds = characters.flatMap((c) => c.skins.map((s) => s.id));
    const badVariants = variantIds.filter(
      (id, index) => !id || variantIds.indexOf(id) !== index,
    );
    assert.deepEqual(badVariants, [], "invalid/duplicate variant IDs");
  });

  it("matches catalog-source.json schema, names, policy exclusions, and exact asset paths", () => {
    assert.equal(source.schemaVersion, 3);
    assert.equal(typeof source.sourceHashes["gl/skin.json"], "string");
    for (const skin of source.characters.flatMap((c) => c.skins)) {
      if (skin.type === "skin") assert.equal(typeof skin.glPresent, "boolean");
      else assert.equal("glPresent" in skin, false);
    }

    const sourceCharNames = new Map(
      source.characters.map((entry) => [entry.baseId, entry.names]),
    );
    const sourcePsyNames = new Map(
      source.psychubes.map((entry) => [entry.id, entry.names]),
    );
    assert.ok(
      characters.every((entry) =>
        isDeepStrictEqual(entry.names, sourceCharNames.get(entry.baseId)),
      ),
      "generated character names drifted from catalog-source.json",
    );
    assert.ok(
      psychubes.every((entry) =>
        isDeepStrictEqual(entry.names, sourcePsyNames.get(entry.id)),
      ),
      "generated psychube names drifted from catalog-source.json",
    );

    // Every policy exclusion stays out of runtime catalogs
    const excludedCharIds = new Set(
      policy.excludedCharacters.map((entry) => entry.baseId),
    );
    const excludedPsyIds = new Set(
      policy.excludedPsychubes.map((entry) => entry.id),
    );
    assert.deepEqual(
      characters.filter((c) => excludedCharIds.has(c.baseId)).map((c) => c.baseId),
      [],
    );
    assert.deepEqual(
      psychubes.filter((p) => excludedPsyIds.has(p.id)).map((p) => p.id),
      [],
    );

    // Generated releaseOrder is 1-based contiguous and Huiji snapshot IDs exist in source
    assert.ok(
      characters.every((entry, index) => entry.releaseOrder === index + 1),
    );
    const orderSources = parseReleaseOrderSources(
      readJson("scripts/data/release-order.json"),
    );
    assert.deepEqual(
      orderSources.huiji.filter((id) => !sourceCharNames.has(id)),
      [],
    );

    const paths = exactAssetPaths(
      characters.flatMap((c) => c.skins.map((s) => s.id)),
      psychubes.map((p) => p.id),
    );
    assert.equal(
      paths.length,
      characters.flatMap((c) => c.skins).length + psychubes.length,
    );
    assert.ok(
      paths.every((file) =>
        /^singlebg\/(headicon_small|equip_defaulticon)\/\d+\.png$/.test(file),
      ),
    );
  });

  it("matches generated release flags to catalog-source.json plus released-overrides.json", () => {
    const overrides = parseReleaseOverrides(
      readJson("scripts/data/released-overrides.json"),
    );
    const index = indexReleaseOverrides(overrides, {
      characters: new Set(source.characters.map((entry) => entry.baseId)),
      skins: new Set(
        source.characters.flatMap((entry) =>
          entry.skins.filter((skin) => skin.type === "skin").map((skin) => skin.id),
        ),
      ),
      psychubes: new Set(source.psychubes.map((entry) => entry.id)),
    });

    const autoReleasedChars = new Set(
      source.characters.filter((e) => e.glReleased).map((e) => e.baseId),
    );
    const glPsychubes = new Set(
      source.psychubes.filter((e) => e.glPresent).map((e) => e.id),
    );
    const sourceSkins = new Map(
      source.characters.flatMap((c) => c.skins.map((s) => [s.id, s] as const)),
    );

    assert.deepEqual(
      characters
        .filter(
          (c) =>
            c.released !==
            (index.characters.get(c.baseId)?.isReleased ??
              autoReleasedChars.has(c.baseId)),
        )
        .map((c) => c.baseId),
      [],
      "character release mismatch",
    );

    assert.deepEqual(
      characters
        .flatMap((c) => c.skins)
        .filter((skin) => {
          const sourceSkin = sourceSkins.get(skin.id);
          if (!sourceSkin) return true;
          return (
            skin.released !==
            resolveSkinRelease(
              sourceSkin.type,
              sourceSkin.type === "skin" ? sourceSkin.glPresent : undefined,
              index.skins.get(skin.id)?.isReleased,
            )
          );
        })
        .map((skin) => skin.id),
      [],
      "skin release mismatch",
    );

    assert.deepEqual(
      psychubes
        .filter(
          (p) =>
            p.released !==
            (index.psychubes.get(p.id)?.isReleased ?? glPsychubes.has(p.id)),
        )
        .map((p) => p.id),
      [],
      "psychube release mismatch",
    );
  });
});
