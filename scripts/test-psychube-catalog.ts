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
import sharp from "sharp";
import { numericPsychubeIconIds } from "./asset-source";
import { completeCatalogNames } from "./catalog-composition";
import type { SourcePsychube } from "./catalog-source";
import { loadCatalogSource } from "./catalog-source";
import {
  effectivePsychubes,
  loadPsychubeImageInventory,
  mergePsychubeSourceRecords,
  parsePsychubeImageInventory,
  persistPsychubeImageCache,
  supplementPsychubeIcons,
  supplementPsychubeIds,
} from "./psychube-catalog";
import { UpstreamRefreshError } from "./sync-refresh";

function psychube(
  id: string,
  zh: string,
  en: string,
  rarity: number | null,
  glPresent: boolean,
): SourcePsychube {
  return {
    id,
    names: completeCatalogNames(zh, en, {}),
    rarity,
    glPresent,
  };
}

const old = psychube("1201", "旧的可信简体名", "Trusted English", 5, true);
const degraded: SourcePsychube = {
  ...old,
  names: {
    "zh-CN": "???",
    "zh-TW": "",
    "en-US": "",
    "ja-JP": "",
    "ko-KR": "",
  },
  rarity: null,
  glPresent: false,
};
const retained = mergePsychubeSourceRecords([old], [degraded]);
assert.equal(retained[0]?.names["zh-CN"], "旧的可信简体名");
assert.equal(retained[0]?.names["en-US"], "Trusted English");
assert.equal(retained[0]?.rarity, 5);
assert.equal(retained[0]?.glPresent, false, "Global presence is independent of retained names and icon state");
assert.deepEqual(mergePsychubeSourceRecords([old], []), [old], "source absence retains the last trusted record");

const staleTranslation = psychube("1207", "旧简中", "Old English", 5, true);
staleTranslation.names["zh-TW"] = "舊繁中";
const explicitSameAsEnglish = psychube("1207", "新简中", "Arrow of Verdict", 5, true);
explicitSameAsEnglish.names["zh-TW"] = "Arrow of Verdict";
assert.equal(
  mergePsychubeSourceRecords([staleTranslation], [explicitSameAsEnglish])[0]?.names["zh-TW"],
  "Arrow of Verdict",
  "a raw Global locale that explicitly repeats English outranks a previous translation",
);

const freshNameOnly = psychube("1202", "名称先到", "Name First", 4, false);
const freshImageOnly = psychube("1203", "", "English only", 4, true);
const jointGlobal = psychube("1204", "全球已实装", "Released Global", 5, true);
const jointFuture = psychube("1205", "国服预告", "Future Global", 5, false);
const candidates = [freshNameOnly, freshImageOnly, jointGlobal, jointFuture];
assert.deepEqual(
  effectivePsychubes(candidates, new Set(["1203", "1204", "1205"])).map((entry) => entry.id),
  ["1204", "1205"],
  "runtime catalog requires both a trusted Simplified Chinese name and a cached image",
);
assert.equal(
  effectivePsychubes([jointGlobal, jointFuture], new Set(["1204", "1205"]))[1]?.glPresent,
  false,
  "CN-only future records remain eligible when their image exists",
);
const optionalEnglish = psychube("1206", "只有简体可信名", "只有简体可信名", null, false);
assert.equal(effectivePsychubes([optionalEnglish], new Set(["1206"])).length, 1);

const digest = createHash("sha256").update("validated icon bytes").digest("hex");
assert.throws(
  () =>
    parsePsychubeImageInventory({
      schemaVersion: 1,
      images: { "1201": { assetPath: "singlebg/equip_defaulticon/1202.png", sha256: digest } },
    }),
  /Invalid psychube image mapping/,
);
const temp = mkdtempSync(path.join(tmpdir(), "psychube-image-map-"));
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
      images: { "1201": { assetPath: "singlebg/equip_defaulticon/1201.png", sha256: digest } },
    }),
  );
  assert.deepEqual(Object.keys(loadPsychubeImageInventory(inventoryFile, cacheDir).images), ["1201"]);
  writeFileSync(imageFile, "changed bytes");
  assert.deepEqual(Object.keys(loadPsychubeImageInventory(inventoryFile, cacheDir).images), [], "byte deterioration cannot count as a trusted image");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

const assetOnlyId = "987654";
const treeIds = numericPsychubeIconIds(
  [
    `singlebg/equip_defaulticon/${assetOnlyId}.png`,
    "singlebg/equip_defaulticon/not-numeric.png",
    "singlebg/headicon_small/987655.png",
    "other/equip_defaulticon/987656.png",
  ].join("\n"),
);
assert.deepEqual(treeIds, [assetOnlyId], "only numeric icon paths in the exact CN Asset tree directory are discovered");
const cnEquipIds: string[] = [];
const globalEquipIds: string[] = [];
assert(!cnEquipIds.includes(assetOnlyId) && !globalEquipIds.includes(assetOnlyId));

const fixture = mkdtempSync(path.join(tmpdir(), "psychube-image-only-source-"));
try {
  const sourceDir = path.join(fixture, "upstream/singlebg/equip_defaulticon");
  const cacheDir = path.join(fixture, "cache");
  const inventoryFile = path.join(fixture, "inventory.json");
  mkdirSync(sourceDir, { recursive: true });
  const sourceImage = path.join(sourceDir, `${assetOnlyId}.png`);
  await sharp({
    create: {
      width: 276,
      height: 228,
      channels: 4,
      background: { r: 32, g: 64, b: 96, alpha: 1 },
    },
  })
    .png()
    .toFile(sourceImage);

  const firstCycle = await persistPsychubeImageCache(
    treeIds,
    sourceDir,
    cacheDir,
    inventoryFile,
  );
  assert.deepEqual(firstCycle, { updated: 1, missing: [] });
  const firstInventory = loadPsychubeImageInventory(inventoryFile, cacheDir);
  assert(firstInventory.images[assetOnlyId], "asset-only icon bytes persist by explicit ID");
  assert.deepEqual(
    effectivePsychubes([], new Set(Object.keys(firstInventory.images))),
    [],
    "an image-only icon is persisted but cannot enter runtime without a source name",
  );

  rmSync(sourceImage);
  const nextCycle = await persistPsychubeImageCache(
    [assetOnlyId],
    sourceDir,
    cacheDir,
    inventoryFile,
  );
  assert.deepEqual(nextCycle, { updated: 0, missing: [] }, "source absence retains the cached icon");
  const retainedInventory = loadPsychubeImageInventory(inventoryFile, cacheDir);
  const laterName = psychube(assetOnlyId, "稍後抵達的簡體名", "Later Name", 5, false);
  assert.deepEqual(
    effectivePsychubes([laterName], new Set(Object.keys(retainedInventory.images))).map((entry) => entry.id),
    [assetOnlyId],
    "a trusted zh-CN name arriving in a later cycle joins the retained asset-only icon",
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

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
  "only the documented supplemental icon endpoint is recorded as a source",
);

assert.deepEqual(
  supplementPsychubeIds(["1580", "1452", "1580"], new Set(["1580"])),
  ["1452"],
  "only catalog psychubes without a validated icon are supplemented",
);
const catalogPsychubeIds = loadCatalogSource().psychubes.map((entry) => entry.id);
assert.deepEqual(
  supplementPsychubeIds(
    catalogPsychubeIds,
    new Set(),
  ).filter((id) => ["1452", "1580", "1581"].includes(id)),
  ["1452", "1580", "1581"],
);
assert.ok(
  !supplementPsychubeIds(catalogPsychubeIds, new Set()).some((id) =>
    ["999", "1000", "1001", "1002", "1003", "1004", "1005"].includes(id),
  ),
  "upgrade materials and their icon IDs never enter the supplemental icon scope",
);

const supplementFixture = mkdtempSync(
  path.join(tmpdir(), "psychube-supplement-"),
);
try {
  const staging = path.join(supplementFixture, "staging");
  const cacheDir = path.join(supplementFixture, "cache");
  const inventoryFile = path.join(supplementFixture, "inventory.json");
  mkdirSync(staging, { recursive: true });
  const writeFixture = async (
    file: string,
    width: number,
    height: number,
    lossless: boolean,
  ): Promise<void> => {
    await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 40, g: 80, b: 120, alpha: 1 },
      },
    })
      .webp(lossless ? { lossless: true } : { quality: 80 })
      .toFile(file);
  };
  const validIcon = path.join(supplementFixture, "valid.webp");
  await writeFixture(validIcon, 276, 228, true);
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
  assert.deepEqual(
    requested,
    ["https://assets.merui.net/equip_defaulticon/1452.webp"],
    "supplemental psychube icons come from equip_defaulticon, not equipment/icon",
  );
  const supplementedInventory = loadPsychubeImageInventory(
    inventoryFile,
    cacheDir,
  );
  assert.equal(
    supplementedInventory.images["1452"]?.source,
    "https://assets.merui.net/equip_defaulticon/1452.webp",
    "the validated supplemental PNG records its real source",
  );
  assert.deepEqual(
    effectivePsychubes(
      [psychube("1452", "完满之路", "The Path to Perfection", 4, false)],
      new Set(Object.keys(supplementedInventory.images)),
    ).map((entry) => entry.id),
    ["1452"],
    "a trusted name plus the supplemental icon reaches the runtime catalog",
  );

  mkdirSync(path.join(staging, "1580.png"));
  await assert.rejects(
    () => supplementPsychubeIcons(
      ["1580"],
      staging,
      cacheDir,
      inventoryFile,
      (_url, output) => copyFileSync(validIcon, output),
    ),
    { code: "EISDIR" },
    "a local PNG write failure must not become an unavailable remote icon",
  );
  rmSync(path.join(staging, "1580.png"), { recursive: true });

  const wrongSizeIcon = path.join(supplementFixture, "wrong-size.webp");
  await writeFixture(wrongSizeIcon, 248, 248, true);
  assert.deepEqual(
    await supplementPsychubeIcons(
      ["1580"],
      staging,
      cacheDir,
      inventoryFile,
      (_url, output) => copyFileSync(wrongSizeIcon, output),
    ),
    { filled: [], unavailable: ["1580"] },
    "a 248×248 equipment/icon image is not accepted as a psychube icon",
  );
  const lossyIcon = path.join(supplementFixture, "lossy.webp");
  await writeFixture(lossyIcon, 276, 228, false);
  assert.deepEqual(
    await supplementPsychubeIcons(
      ["1581"],
      staging,
      cacheDir,
      inventoryFile,
      (_url, output) => copyFileSync(lossyIcon, output),
    ),
    { filled: [], unavailable: ["1581"] },
    "a lossy supplemental image is refused instead of re-encoded",
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
    "a missing supplemental icon leaves the existing cache untouched",
  );
  assert.deepEqual(
    Object.keys(loadPsychubeImageInventory(inventoryFile, cacheDir).images),
    ["1452"],
    "rejected supplemental images never enter the inventory",
  );
} finally {
  rmSync(supplementFixture, { recursive: true, force: true });
}

console.log("psychube snapshot and name-image intersection checks passed");
