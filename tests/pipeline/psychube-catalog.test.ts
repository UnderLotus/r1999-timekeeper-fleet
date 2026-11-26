import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { numericPsychubeIconIds } from "../../scripts/asset-source";
import type { SourcePsychube } from "../../scripts/catalog-source";
import {
  effectivePsychubes,
  loadPsychubeImageInventory,
  mergePsychubeSourceRecords,
  parsePsychubeImageInventory,
  persistPsychubeImageCache,
  supplementPsychubeIcons,
  supplementPsychubeIds,
} from "../../scripts/psychube-catalog";
import { UpstreamRefreshError } from "../../scripts/sync-refresh";
import { writeTestPng, writeTestWebp } from "../helpers/pipeline-fixtures";

function makePsychube(
  id: string,
  zh: string,
  en: string,
  rarity: number | null,
  glPresent: boolean,
): SourcePsychube {
  const names: SourcePsychube["names"] = {};
  if (zh) names["zh-CN"] = zh;
  if (en) names["en-US"] = en;
  return { id, names, rarity, glPresent };
}

describe("psychube catalog merging & runtime eligibility", () => {
  it("retains trusted names and rarity through deterioration/absence while keeping glPresent independent", () => {
    const old = makePsychube("1201", "旧的可信简体名", "Trusted English", 5, true);
    const degraded: SourcePsychube = {
      ...old,
      names: { "zh-CN": "???", "zh-TW": "", "en-US": "", "ja-JP": "", "ko-KR": "" },
      rarity: null,
      glPresent: false,
    };
    const retained = mergePsychubeSourceRecords([old], [degraded]);
    assert.equal(retained[0]?.names["zh-CN"], "旧的可信简体名");
    assert.equal(retained[0]?.names["en-US"], "Trusted English");
    assert.equal(retained[0]?.rarity, 5);
    assert.equal(retained[0]?.glPresent, false);
    assert.deepEqual(mergePsychubeSourceRecords([old], []), [old]);

    // Missing locales stay absent; temporarily missing locale keeps LKG; arriving or explicit same-as-EN updates
    assert.deepEqual(
      mergePsychubeSourceRecords(
        [],
        [makePsychube("1208", "只有简中", "Only English", 5, true)],
      )[0]?.names,
      { "zh-CN": "只有简中", "en-US": "Only English" },
    );

    const withJa: SourcePsychube = {
      ...makePsychube("1209", "旧简中", "Old English", 5, true),
      names: { "zh-CN": "旧简中", "en-US": "Old English", "ja-JP": "既存の訳" },
    };
    assert.equal(
      mergePsychubeSourceRecords(
        [withJa],
        [makePsychube("1209", "新简中", "New English", 5, true)],
      )[0]?.names["ja-JP"],
      "既存の訳",
    );
    const updatedJa = makePsychube("1209", "新简中", "New English", 5, true);
    updatedJa.names["ja-JP"] = "新しい訳";
    assert.equal(
      mergePsychubeSourceRecords([withJa], [updatedJa])[0]?.names["ja-JP"],
      "新しい訳",
    );

    const priorTw = makePsychube("1207", "旧简中", "Old English", 5, true);
    priorTw.names["zh-TW"] = "舊繁中";
    const explicitSameAsEn = makePsychube("1207", "新简中", "Arrow of Verdict", 5, true);
    explicitSameAsEn.names["zh-TW"] = "Arrow of Verdict";
    assert.equal(
      mergePsychubeSourceRecords([priorTw], [explicitSameAsEn])[0]?.names["zh-TW"],
      "Arrow of Verdict",
    );
  });

  it("admits only psychubes with both a trusted zh-CN name and a validated image", () => {
    const candidates = [
      makePsychube("1202", "名称先到", "Name First", 4, false),
      makePsychube("1203", "", "English only", 4, true),
      makePsychube("1204", "全球已实装", "Released Global", 5, true),
      makePsychube("1205", "国服预告", "Future Global", 5, false),
      makePsychube("1206", "只有简体可信名", "只有简体可信名", null, false),
    ];
    const effective = effectivePsychubes(
      candidates,
      new Set(["1203", "1204", "1205", "1206"]),
    );
    assert.deepEqual(
      effective.map((entry) => entry.id),
      ["1204", "1205", "1206"],
    );
    assert.equal(effective[1]?.glPresent, false);
  });
});

describe("psychube image inventory, cache persistence & UTTU icon supplement", () => {
  it("validates inventory paths/sources and detects tampered cached bytes", () => {
    const digest = createHash("sha256")
      .update("validated icon bytes")
      .digest("hex");

    assert.throws(
      () =>
        parsePsychubeImageInventory({
          schemaVersion: 1,
          images: {
            "1201": {
              assetPath: "singlebg/equip_defaulticon/1202.png",
              sha256: digest,
            },
          },
        }),
      /Invalid psychube image mapping/,
    );
    assert.throws(
      () =>
        parsePsychubeImageInventory({
          schemaVersion: 1,
          images: {
            "1452": {
              assetPath: "singlebg/equip_defaulticon/1452.png",
              sha256: digest,
              source: "https://example.com/equipment/icon/1452.webp",
            },
          },
        }),
      /Invalid psychube image source/,
    );

    const temp = mkdtempSync(path.join(tmpdir(), "r1999-psy-inventory-"));
    try {
      const cacheDir = path.join(temp, "cache");
      const inventoryFile = path.join(temp, "inventory.json");
      const imageFile = path.join(cacheDir, "1201.png");
      mkdirSync(cacheDir);
      writeFileSync(imageFile, "validated icon bytes");
      writeFileSync(
        inventoryFile,
        JSON.stringify({
          schemaVersion: 1,
          images: {
            "1201": {
              assetPath: "singlebg/equip_defaulticon/1201.png",
              sha256: digest,
            },
          },
        }),
      );
      assert.deepEqual(
        Object.keys(loadPsychubeImageInventory(inventoryFile, cacheDir).images),
        ["1201"],
      );
      writeFileSync(imageFile, "changed bytes");
      assert.deepEqual(
        Object.keys(loadPsychubeImageInventory(inventoryFile, cacheDir).images),
        [],
      );
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("persists numeric icon-only assets across source absence until a trusted zh-CN name arrives", async () => {
    const assetOnlyId = "987654";
    const treeIds = numericPsychubeIconIds(
      [
        `singlebg/equip_defaulticon/${assetOnlyId}.png`,
        "singlebg/equip_defaulticon/not-numeric.png",
        "singlebg/headicon_small/987655.png",
        "other/equip_defaulticon/987656.png",
      ].join("\n"),
    );
    assert.deepEqual(treeIds, [assetOnlyId]);

    const fixture = mkdtempSync(path.join(tmpdir(), "r1999-psy-cache-"));
    try {
      const sourceDir = path.join(fixture, "upstream/singlebg/equip_defaulticon");
      const cacheDir = path.join(fixture, "cache");
      const inventoryFile = path.join(fixture, "inventory.json");
      mkdirSync(sourceDir, { recursive: true });
      const sourceImage = path.join(sourceDir, `${assetOnlyId}.png`);
      await writeTestPng(sourceImage, 276, 228);

      const firstCycle = await persistPsychubeImageCache(
        treeIds,
        sourceDir,
        cacheDir,
        inventoryFile,
      );
      assert.deepEqual(firstCycle, { updated: 1, missing: [] });
      const firstInventory = loadPsychubeImageInventory(inventoryFile, cacheDir);
      assert.ok(firstInventory.images[assetOnlyId]);
      assert.deepEqual(
        effectivePsychubes([], new Set(Object.keys(firstInventory.images))),
        [],
      );

      // Source disappears in a later sync; cached PNG stays trusted and pairs with arriving name
      rmSync(sourceImage);
      const nextCycle = await persistPsychubeImageCache(
        [assetOnlyId],
        sourceDir,
        cacheDir,
        inventoryFile,
      );
      assert.deepEqual(nextCycle, { updated: 0, missing: [] });
      const retainedInventory = loadPsychubeImageInventory(inventoryFile, cacheDir);
      const laterName = makePsychube(assetOnlyId, "稍后抵达的简体名", "Later", 5, false);
      assert.deepEqual(
        effectivePsychubes(
          [laterName],
          new Set(Object.keys(retainedInventory.images)),
        ).map((entry) => entry.id),
        [assetOnlyId],
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("supplements only missing catalog psychube icons from equip_defaulticon and rejects invalid candidates", async () => {
    assert.deepEqual(
      supplementPsychubeIds(["1580", "1452", "1580"], new Set(["1580"])),
      ["1452"],
    );

    const fixture = mkdtempSync(path.join(tmpdir(), "r1999-psy-supplement-"));
    try {
      const staging = path.join(fixture, "staging");
      const cacheDir = path.join(fixture, "cache");
      const inventoryFile = path.join(fixture, "inventory.json");
      mkdirSync(staging, { recursive: true });

      const validIcon = path.join(fixture, "valid.webp");
      const wrongSizeIcon = path.join(fixture, "wrong-size.webp");
      const lossyIcon = path.join(fixture, "lossy.webp");
      await writeTestWebp(validIcon, 276, 228, { lossless: true });
      await writeTestWebp(wrongSizeIcon, 248, 248, { lossless: true });
      await writeTestWebp(lossyIcon, 276, 228, { lossless: false });

      const requested: string[] = [];
      const filled = await supplementPsychubeIcons(
        ["1452"],
        staging,
        cacheDir,
        inventoryFile,
        (url, output) => {
          requested.push(url);
          copyFileSync(validIcon, output);
        },
      );
      assert.deepEqual(filled, { filled: ["1452"], unavailable: [] });
      assert.deepEqual(requested, [
        "https://assets.merui.net/equip_defaulticon/1452.webp",
      ]);

      const inventory = loadPsychubeImageInventory(inventoryFile, cacheDir);
      assert.equal(
        inventory.images["1452"]?.source,
        "https://assets.merui.net/equip_defaulticon/1452.webp",
      );

      // Wrong dimensions, lossy encoding, and upstream 404 stay unavailable without altering cache
      assert.deepEqual(
        await supplementPsychubeIcons(
          ["1580"],
          staging,
          cacheDir,
          inventoryFile,
          (_url, output) => copyFileSync(wrongSizeIcon, output),
        ),
        { filled: [], unavailable: ["1580"] },
      );
      assert.deepEqual(
        await supplementPsychubeIcons(
          ["1582"],
          staging,
          cacheDir,
          inventoryFile,
          (_url, output) => copyFileSync(lossyIcon, output),
        ),
        { filled: [], unavailable: ["1582"] },
      );
      assert.deepEqual(
        await supplementPsychubeIcons(
          ["1581"],
          staging,
          cacheDir,
          inventoryFile,
          () => {
            throw new UpstreamRefreshError("fixture 404");
          },
        ),
        { filled: [], unavailable: ["1581"] },
      );
      assert.deepEqual(
        Object.keys(loadPsychubeImageInventory(inventoryFile, cacheDir).images),
        ["1452"],
      );

      // Local programming errors must abort rather than be swallowed as unavailable
      await assert.rejects(
        () =>
          supplementPsychubeIcons(
            ["1583"],
            staging,
            cacheDir,
            inventoryFile,
            () => {
              throw new Error("fixture programming failure");
            },
          ),
        /fixture programming failure/,
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
