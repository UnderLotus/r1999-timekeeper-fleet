import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertExactAssetWorktree,
  exactAssetPaths,
} from "../../scripts/asset-source";
import type { CnPackageSkin } from "../../scripts/catalog-composition";
import {
  classifyMissingCharacterAsset,
  collectCharacterAssetCandidates,
  filterRuntimeCharacterSkins,
} from "../../scripts/character-assets";
import { computeUnmappedCnSkins } from "../../scripts/skin-mapping-diff";
import type { ArcanistEntryFull } from "../../scripts/skin-utils";
import {
  collectNeeded,
  loadHashCache,
  parseHashCache,
  type HashCache,
} from "../../scripts/sync-assets";
import { makeArcanistSkin } from "../helpers/pipeline-fixtures";

describe("character variant assets & runtime filtering", () => {
  const sourceCharacter = {
    id: "9912",
    baseId: "9912",
    names: { "zh-CN": "Fixture" },
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

  it("discovers asset candidates directly from catalog source including arbitrary-width Skin IDs", () => {
    const source = {
      schemaVersion: 3 as const,
      sourceHashes: {},
      characters: [sourceCharacter],
      psychubes: [
        { id: "2001", names: { "zh-CN": "Fixture" }, rarity: 5, glPresent: true },
      ],
    };
    assert.deepEqual(
      collectCharacterAssetCandidates(source.characters).map((c) => c.id),
      ["991201", "991202", "991234567"],
    );
    assert.deepEqual(
      collectNeeded(source).characters.map((c) => c.id),
      ["991201", "991202", "991234567"],
    );
  });

  it("prioritizes primary PNG > trusted production WebP > supplemental WebP > skip", () => {
    assert.equal(classifyMissingCharacterAsset(true, true, true), "convert");
    assert.equal(classifyMissingCharacterAsset(true, false, true), "convert");
    assert.equal(classifyMissingCharacterAsset(false, true, true), "retain");
    assert.equal(classifyMissingCharacterAsset(false, true, false), "retain");
    assert.equal(
      classifyMissingCharacterAsset(false, false, true),
      "install-supplement",
    );
    assert.equal(classifyMissingCharacterAsset(false, false, false), "skip");
  });

  it("withholds a character until default & insight images exist, while hiding only missing Skins", () => {
    assert.deepEqual(
      filterRuntimeCharacterSkins(
        sourceCharacter.skins,
        new Set(["991201", "991202"]),
      )?.map((skin) => skin.id),
      ["991201", "991202"],
    );
    assert.deepEqual(
      filterRuntimeCharacterSkins(
        sourceCharacter.skins,
        new Set(["991201", "991202", "991234567"]),
      )?.map((skin) => skin.id),
      ["991201", "991202", "991234567"],
    );
    assert.equal(
      filterRuntimeCharacterSkins(sourceCharacter.skins, new Set(["991201"])),
      null,
    );
    assert.equal(
      filterRuntimeCharacterSkins(sourceCharacter.skins, new Set(["991202"])),
      null,
    );
  });
});

describe("asset hash cache", () => {
  it("accepts absent cache, valid digests and sentinels, and rejects malformed JSON or schema", () => {
    const root = mkdtempSync(path.join(tmpdir(), "r1999-asset-hash-cache-"));
    const digest = "a".repeat(64);
    const otherDigest = "b".repeat(64);
    const valid: HashCache = {
      "1201": { png: digest, webp: otherDigest },
      "312503": { png: "preserved", webp: "retained-webp" },
      "9912": { png: "retained", webp: "webp-sentinel-compatible" },
    };
    try {
      assert.deepEqual(loadHashCache(path.join(root, "absent.json")), {});

      const validFile = path.join(root, "valid.json");
      writeFileSync(validFile, JSON.stringify(valid));
      assert.deepEqual(loadHashCache(validFile), valid);
      assert.deepEqual(parseHashCache(valid), valid);

      const malformedJson = path.join(root, "malformed.json");
      writeFileSync(malformedJson, "{");
      assert.throws(() => loadHashCache(malformedJson), SyntaxError);

      for (const [name, value] of [
        ["invalid-png", { "1201": { png: "not-a-digest", webp: otherDigest } }],
        ["wrong-types", { "1201": { png: digest, webp: 42 } }],
      ] as const) {
        const file = path.join(root, `${name}.json`);
        writeFileSync(file, JSON.stringify(value));
        assert.throws(() => loadHashCache(file));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("exact asset allowlist, worktree check, and unmapped CN skin diff", () => {
  it("builds exact asset paths and rejects missing or unexpected worktree files", () => {
    assert.deepEqual(exactAssetPaths(["300301"], ["1000"]), [
      "singlebg/equip_defaulticon/1000.png",
      "singlebg/headicon_small/300301.png",
    ]);
    assert.throws(() => exactAssetPaths(["../bad"], []));

    const root = mkdtempSync(path.join(tmpdir(), "r1999-asset-worktree-"));
    try {
      const charDir = path.join(root, "singlebg/headicon_small");
      const psyDir = path.join(root, "singlebg/equip_defaulticon");
      mkdirSync(charDir, { recursive: true });
      mkdirSync(psyDir, { recursive: true });
      writeFileSync(path.join(charDir, "300301.png"), "x");
      writeFileSync(path.join(psyDir, "1000.png"), "x");

      const expected = [
        "singlebg/headicon_small/300301.png",
        "singlebg/equip_defaulticon/1000.png",
      ];
      // Exact match passes; allowed upstream missing path also passes
      assertExactAssetWorktree(root, expected);
      assertExactAssetWorktree(
        root,
        [...expected, "singlebg/headicon_small/300302.png"],
        ["singlebg/headicon_small/300302.png"],
      );
      // File present in Git tree (not allowed missing) but missing locally fails loudly
      assert.throws(
        () =>
          assertExactAssetWorktree(root, [
            ...expected,
            "singlebg/headicon_small/300302.png",
          ]),
        /missing=singlebg\/headicon_small\/300302\.png/,
      );
      // Unexpected extra file fails loudly
      writeFileSync(path.join(charDir, "999999.png"), "x");
      assert.throws(
        () => assertExactAssetWorktree(root, expected),
        /unexpected=singlebg\/headicon_small\/999999\.png/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports unmapped CN skins using characterId (not Variant width) and filters ignored stubs", () => {
    const arcanists: ArcanistEntryFull[] = [
      {
        id: 3080,
        name: "Kakania",
        nameEng: "Kakania",
        live2d: [makeArcanistSkin(308001)],
      },
      { id: 3066, name: "37", nameEng: "Thirty-seven", live2d: [] },
      { id: 9999, name: "Excluded", nameEng: "Excluded", live2d: [] },
    ];
    const cnSkins: CnPackageSkin[] = [
      { id: 308001, characterId: 3080 },
      { id: 308005, characterId: 3080 },
      { id: 30660001, characterId: 3066 },
      { id: 700101, characterId: 0 },
    ];

    const diff = computeUnmappedCnSkins(cnSkins, arcanists);
    assert.deepEqual(
      diff.map((entry) => [entry.id, entry.baseId, entry.name]),
      [
        ["30660001", "3066", "37"],
        ["308005", "3080", "Kakania"],
      ],
    );

    const filtered = computeUnmappedCnSkins(
      cnSkins,
      arcanists,
      new Set(["308005", "30660001"]),
    );
    assert.deepEqual(filtered, []);
  });
});
