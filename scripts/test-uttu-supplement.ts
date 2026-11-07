import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

import { composeCatalogSource } from "./catalog-composition";
import { buildSkins, type ArcanistEntryFull } from "./skin-utils";
import { UpstreamRefreshError } from "./sync-refresh";
import { fetchUttuCatalogSafely } from "./sync-uttu";
import { cacheUttuHeadicon, hasValidUttuHeadicon, validateUttuHeadicon } from "./uttu-images";
import {
  parseUttuCatalog,
  UttuOwnershipConflictError,
  UttuParseError,
} from "./uttu-parser";
import {
  assertSupplementCandidateHash,
  assertSupplementInstalled,
  collectPlannedVariantIds,
  completeUttuAdmissions,
  emptyUttuSupplement,
  loadUttuSupplement,
  loadUttuSupplementForBuild,
  mergeSupplementPackageCharacters,
  mergeUttuSupplement,
  parseUttuSupplement,
  planUttuAdmissions,
  promoteUttuSupplement,
  type UttuSupplement,
} from "./uttu-supplement";
import { hasLosslessWebpChunk } from "./webp-converter";

const root = mkdtempSync(path.join(tmpdir(), "r1999-uttu-supplement-"));

async function writeWebp(
  file: string,
  width: number,
  height: number,
  options: { alpha?: number; lossless?: boolean } = {},
): Promise<void> {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: options.alpha ?? 1 },
    },
  })
    .webp(options.lossless === false ? { quality: 80 } : { lossless: true })
    .toFile(file);
}

function arcanist(
  id: number,
  variants: Array<["default" | "insight" | "skin", string]>,
): ArcanistEntryFull {
  return {
    id,
    name: `CN ${id}`,
    nameEng: `EN ${id}`,
    live2d: variants.map(([type, variantId]) => ({
      id: variantId,
      name: "",
      nameEng: "",
      des:
        type === "default" ? "初始皮肤" : type === "insight" ? "进阶皮肤" : "",
      characterSkin: "",
      characterSkinNameEng: "",
    })),
  };
}

function emptyPage(): string {
  return "<html><body>no client data</body></html>";
}

const profilesHtml = `<html><script>const T=[{ID:9001,Name:"甲",Rarity:6,LocaleName:{en:"Alpha",zh:"甲",tw:"N/A"}},{ID:9002,Name:"乙",Rarity:4,LocaleName:{en:"Beta",zh:"乙",jp:"ベータ"}}];</script></html>`;
const garmentsHtml = `<html><script>const R=[
{profile:{ID:9001,Name:"甲"},garment:{id:900101,name:{en:"Default",zh:"Default"},category:"default",version:4,global:!1}},
{profile:{ID:9001,Name:"甲"},garment:{id:900102,name:{en:"Insight",zh:"N/A"},category:"insight",version:4,global:!1}},
{profile:{ID:9001,Name:"甲"},garment:{id:900103,name:{en:"Skin",zh:"衣"},category:"advanced",version:4,global:!0}},
{profile:{ID:9002,Name:"乙"},garment:{id:900201,name:{en:"Default",zh:"Default"},category:"default"}},
{profile:{ID:9002,Name:"乙"},garment:{id:900202,name:{en:"N/A",zh:"N/A"},category:"basic"}}
];</script></html>`;

async function main(): Promise<void> {
  const catalog = parseUttuCatalog(profilesHtml, garmentsHtml);
  assert.deepEqual(
    catalog.profiles.map((profile) => profile.baseId),
    [9001, 9002],
    "profiles are normalized and sorted by exact base ID",
  );
  assert.deepEqual(
    catalog.profiles[0].names,
    { "zh-CN": "甲", "en-US": "Alpha" },
    "N/A localized names are treated as absent",
  );
  assert.equal(
    catalog.profiles[1].names["ja-JP"],
    "ベータ",
    "available UTTU translations are kept",
  );
  assert.deepEqual(
    catalog.garments.map((garment) => [garment.variantId, garment.type, garment.name, garment.nameEn]),
    [
      ["900101", "default", null, null],
      ["900102", "insight", null, "Insight"],
      ["900103", "skin", "衣", "Skin"],
      ["900201", "default", null, null],
    ],
    "only real garments survive, default rows carry no garment name",
  );
  assert.deepEqual(
    Object.keys(catalog.garments[2]).sort(),
    ["baseId", "name", "nameEn", "type", "variantId"],
    "UTTU release metadata never reaches the parsed garment",
  );
  assert.deepEqual(
    [...catalog.incompleteBaseIds],
    [9002],
    "a garment without a usable name marks its character incomplete",
  );

  assert.throws(
    () =>
      parseUttuCatalog(
        `<html><script>const T=[{ID:window.id,Name:"甲",Rarity:6,LocaleName:{zh:"甲"}}];</script></html>`,
        garmentsHtml,
      ),
    UttuParseError,
    "non-literal profile data is rejected instead of executed",
  );
  assert.throws(
    () => parseUttuCatalog(emptyPage(), garmentsHtml),
    UttuParseError,
    "an empty profiles page is a parse failure, not an empty catalog",
  );
  assert.throws(
    () => parseUttuCatalog(profilesHtml, emptyPage()),
    UttuParseError,
    "an empty garments page is a parse failure",
  );
  assert.throws(
    () =>
      parseUttuCatalog(
        `<html><script>const T=[{ID:9001,Name:"甲",Rarity:6,LocaleName:{zh:"甲"}},{ID:9001,Name:"甲",Rarity:6,LocaleName:{zh:"甲"}}];</script></html>`,
        garmentsHtml,
      ),
    /Duplicate UTTU profile ID: 9001/,
    "duplicate profile IDs stop the extraction",
  );
  const dedupedRows = parseUttuCatalog(
    profilesHtml,
    `<html><script>const R=[
{profile:{ID:9001},garment:{id:900101,name:{en:"One"},category:"basic"}},
{profile:{ID:9001},garment:{id:900101,name:{en:"One"},category:"basic"}},
{profile:{ID:9001},garment:{id:900102,name:{en:"Three"},category:"mystery"}}
];</script></html>`,
  );
  assert.deepEqual(
    dedupedRows.garments.map((garment) => garment.variantId),
    ["900101"],
    "identical duplicate rows dedupe to one exact Variant",
  );
  assert.deepEqual(
    [...dedupedRows.incompleteBaseIds],
    [9001],
    "an unknown category marks its character incomplete",
  );
  assert.throws(
    () =>
      parseUttuCatalog(
        profilesHtml,
        `<html><script>const R=[
{profile:{ID:9001},garment:{id:900101,name:{en:"One"},category:"basic"}},
{profile:{ID:9002},garment:{id:900101,name:{en:"Two"},category:"basic"}}
];</script></html>`,
      ),
    UttuOwnershipConflictError,
    "two profiles claiming one exact Variant stops the refresh instead of picking a winner",
  );
  assert.throws(
    () =>
      parseUttuCatalog(
        profilesHtml,
        `<html><script>const R=[
{profile:{ID:9001},garment:{id:900101,name:{en:"One"},category:"default"}},
{profile:{ID:9001},garment:{id:900101,name:{en:"One"},category:"insight"}}
];</script></html>`,
      ),
    UttuOwnershipConflictError,
    "one owner listing two types for one exact Variant stops the refresh",
  );

  const validSupplement: UttuSupplement = {
    schemaVersion: 1,
    source: {
      profilesUrl: "https://uttu.merui.net/profiles/",
      garmentsUrl: "https://uttu.merui.net/garments/",
      headiconSmallUrl: "https://assets.merui.net/headicon_small/",
      equipDefaultIconUrl: "https://assets.merui.net/equip_defaulticon/",
    },
    characters: [
      {
        baseId: "9100",
        name: "甲",
        nameEng: "Alpha",
        names: { "zh-CN": "甲", "en-US": "Alpha" },
        stars: 6,
        defaultVariant: "910001",
        skins: [
          { variantId: "910001", type: "default", name: null, nameEn: null },
          { variantId: "910002", type: "insight", name: "洞悉", nameEn: "Insight" },
        ],
      },
    ],
    skins: [],
  };
  assert.deepEqual(
    parseUttuSupplement(validSupplement),
    validSupplement,
    "a complete supplement round-trips through validation",
  );
  assert.throws(
    () => parseUttuSupplement({ ...validSupplement, schemaVersion: 2 }),
    /schemaVersion/,
    "an unknown supplement schema is rejected",
  );
  assert.throws(
    () => parseUttuSupplement({ ...validSupplement, source: undefined }),
    /source metadata/,
    "source provenance is required",
  );
  const namedDefault = structuredClone(validSupplement);
  namedDefault.characters[0].skins[0].name = "初始";
  assert.throws(
    () => parseUttuSupplement(namedDefault),
    /must not carry garment names/,
    "a default Variant cannot carry a garment name",
  );
  const missingDefault = structuredClone(validSupplement);
  missingDefault.characters[0].skins = missingDefault.characters[0].skins.slice(1);
  assert.throws(
    () => parseUttuSupplement(missingDefault),
    /exactly one explicit default/,
    "a supplement character needs exactly one explicit default",
  );
  const duplicateVariant = structuredClone(validSupplement);
  duplicateVariant.skins = [
    { baseId: "9000", variantId: "900003", type: "skin", name: "一", nameEn: "One" },
    { baseId: "9001", variantId: "900003", type: "skin", name: "二", nameEn: "Two" },
  ];
  assert.throws(
    () => parseUttuSupplement(duplicateVariant),
    /Duplicate supplement Variant ID: 900003/,
    "a Variant can only be admitted once",
  );
  const characterDuplicate = structuredClone(validSupplement);
  characterDuplicate.skins.push({
    baseId: "9100",
    variantId: "910002",
    type: "skin",
    name: "重複",
    nameEn: "Duplicate",
  });
  assert.throws(
    () => parseUttuSupplement(characterDuplicate),
    /duplicates its new character record/,
    "a standalone Skin cannot repeat an admitted character Variant",
  );
  const naSkinnedName = structuredClone(validSupplement);
  naSkinnedName.skins = [
    { baseId: "9100", variantId: "910003", type: "skin", name: "N/A", nameEn: null },
  ];
  assert.throws(
    () => parseUttuSupplement(naSkinnedName),
    /empty or N\/A/,
    "an N/A garment name is not stored as a name",
  );

  const primary = [
    arcanist(9000, [
      ["default", "900001"],
      ["insight", "900002"],
    ]),
    arcanist(9001, [["default", "900101"]]),
  ];
  const mergedNew = mergeUttuSupplement(primary, validSupplement);
  assert.deepEqual(
    mergedNew.characters,
    [{ id: 9100, name: "甲", nameEng: "Alpha", rare: 5 }],
    "a six-star UTTU character is adapted to the catalog's zero-based rare",
  );
  assert.deepEqual(
    buildSkins(mergedNew.arcanists.find((entry) => String(entry.id) === "9100")!).map(
      (skin) => [skin.id, skin.type],
    ),
    [
      ["910001", "default"],
      ["910002", "insight"],
    ],
    "supplemental Variants keep their explicit types",
  );
  const emptyLanguages = {
    "zh-CN": {},
    "zh-TW": {},
    "en-US": {},
    "ja-JP": {},
    "ko-KR": {},
  };
  const emptyPolicy = {
    excludedCharacters: [],
    excludedPsychubes: [],
    characterCapabilities: [],
    preservedCharacterAssets: [],
    ignoredCnSkinStubs: [],
  };
  const compositionSupplement = parseUttuSupplement({
    ...validSupplement,
    characters: [
      {
        baseId: "9300",
        name: "丙",
        nameEng: "Gamma",
        names: { "zh-CN": "丙", "en-US": "Gamma", "ja-JP": "UTTU日本語" },
        stars: 6,
        defaultVariant: "930001",
        skins: [
          { variantId: "930001", type: "default", name: null, nameEn: null },
          { variantId: "930002", type: "insight", name: "洞悉", nameEn: "Insight" },
        ],
      },
      {
        baseId: "9301",
        name: "丁",
        nameEng: "Delta",
        names: { "zh-CN": "丁", "en-US": "Delta", "ja-JP": "UTTU日本語" },
        stars: 6,
        defaultVariant: "930101",
        skins: [
          { variantId: "930101", type: "default", name: null, nameEn: null },
          { variantId: "930102", type: "insight", name: "洞悉", nameEn: "Insight" },
        ],
      },
    ],
    skins: [],
  });
  const compositionMerge = mergeUttuSupplement([], compositionSupplement);
  const composed = composeCatalogSource({
    arcanists: compositionMerge.arcanists,
    cnCharacters: mergeSupplementPackageCharacters(
      [
        { id: 9300, name: "可信CN正名", nameEng: "Trusted CN English", rare: 4 },
        { id: 9301, name: "", nameEng: "", rare: undefined },
      ],
      compositionMerge.characters,
    ),
    globalCharacters: [],
    // The CN package lists none of these Variants; only the supplement adapter
    // supplies their ownership rows.
    cnSkins: compositionMerge.skins,
    globalSkins: [],
    cnEquips: [],
    globalEquips: [],
    languages: emptyLanguages,
    nameFallbacks: new Map([["9301", { "ja-JP": "Fallback日本語" }]]),
    nameOverrides: new Map([["9301", { "zh-TW": "Manual繁中" }]]),
    supplementNames: new Map(
      compositionMerge.supplement.characters.map((character) => [
        character.baseId,
        character.names,
      ]),
    ),
    policy: emptyPolicy,
    releaseClock: new Date("2026-01-01T00:00:00.000Z"),
  });
  const gamma = composed.characters.find((entry) => entry.baseId === "9300");
  const delta = composed.characters.find((entry) => entry.baseId === "9301");
  assert.equal(
    gamma?.rarity,
    4,
    "a trusted CN rare outranks the UTTU six-star rating",
  );
  assert.equal(
    delta?.rarity,
    5,
    "a missing CN rare falls back to the normalized UTTU rating",
  );
  assert.deepEqual(
    gamma?.skins.map((skin) => [skin.id, skin.type]),
    [
      ["930001", "default"],
      ["930002", "insight"],
    ],
    "admitted Variants reach the catalog even when the CN package lists none",
  );
  assert.deepEqual(
    delta?.skins.map((skin) => skin.id),
    ["930101", "930102"],
    "every admitted Variant survives the CN skin gate",
  );
  assert.equal(
    gamma?.names["ja-JP"],
    "UTTU日本語",
    "UTTU localized names are the lowest fallback layer",
  );
  assert.equal(gamma?.names["zh-CN"], "可信CN正名");
  assert.equal(
    gamma?.names["en-US"],
    "Trusted CN English",
    "trusted CN names outrank supplemental translations in the final catalog",
  );
  assert.equal(delta?.names["zh-CN"], "丁");
  assert.equal(delta?.names["en-US"], "Delta");
  assert.equal(
    delta?.names["ja-JP"],
    "Fallback日本語",
    "an existing fallback name outranks the UTTU translation",
  );
  assert.equal(
    delta?.names["zh-TW"],
    "Manual繁中",
    "a manual localized name outranks the UTTU translation",
  );

  assert.deepEqual(
    mergedNew.arcanists.find((entry) => String(entry.id) === "9000"),
    primary[0],
    "a primary character without supplemental Variants is untouched",
  );

  const skinOnlySupplement = parseUttuSupplement({
    ...validSupplement,
    characters: [],
    skins: [
      { baseId: "9000", variantId: "900003", type: "skin", name: "新衣", nameEn: "New" },
    ],
  });
  const mergedSkin = mergeUttuSupplement(primary, skinOnlySupplement);
  assert.deepEqual(
    mergedSkin.skins,
    [{ id: 900003, characterId: 9000 }],
    "a known character receives only the garment Variant row",
  );
  assert.deepEqual(
    buildSkins(mergedSkin.arcanists.find((entry) => String(entry.id) === "9000")!).map(
      (skin) => [skin.id, skin.type, skin.name],
    ),
    [
      ["900001", "default", undefined],
      ["900002", "insight", undefined],
      ["900003", "skin", "新衣"],
    ],
    "the supplemental Skin is appended with its garment name",
  );

  const returnedSupplement = parseUttuSupplement({
    ...validSupplement,
    characters: [],
    skins: [
      { baseId: "9000", variantId: "900002", type: "insight", name: "洞悉", nameEn: "Insight" },
    ],
  });
  const mergedReturned = mergeUttuSupplement(primary, returnedSupplement);
  assert.deepEqual(
    mergedReturned.returnedToPrimary,
    ["900002"],
    "an exact Variant the ArcanistMap now owns returns to primary",
  );
  assert.deepEqual(
    mergedReturned.supplement.skins,
    [],
    "returned admissions leave the supplement instead of duplicating primary",
  );
  assert.deepEqual(
    buildSkins(mergedReturned.arcanists.find((entry) => String(entry.id) === "9000")!),
    buildSkins(primary[0]),
    "returning to primary does not append a duplicate Variant",
  );

  assert.throws(
    () =>
      mergeUttuSupplement(
        primary,
        parseUttuSupplement({
          ...validSupplement,
          characters: [],
          skins: [
            { baseId: "9000", variantId: "900002", type: "skin", name: "類型", nameEn: "Type" },
          ],
        }),
      ),
    /type skin conflicts with primary type insight/,
    "a type conflict against the primary mapping stops the build",
  );
  assert.throws(
    () =>
      mergeUttuSupplement(
        primary,
        parseUttuSupplement({
          ...validSupplement,
          characters: [],
          skins: [
            { baseId: "9000", variantId: "900101", type: "skin", name: "別人的", nameEn: "Other" },
          ],
        }),
      ),
    /owned by primary character 9001, not 9000/,
    "an owner conflict against the primary mapping stops the build",
  );
  assert.throws(
    () =>
      mergeUttuSupplement(
        primary,
        parseUttuSupplement({
          ...validSupplement,
          characters: [],
          skins: [
            { baseId: "9000", variantId: "900099", type: "insight", name: "洞悉", nameEn: "Insight" },
          ],
        }),
      ),
    /Unsupported primary catch-up for character 9000: admitted insight 900099 competes with primary 900002/,
    "competing primary default/insight metadata stops the build",
  );
  assert.throws(
    () =>
      mergeUttuSupplement(
        primary,
        parseUttuSupplement({
          ...validSupplement,
          characters: [
            {
              baseId: "9000",
              name: "甲",
              nameEng: "Alpha",
              names: { "zh-CN": "甲", "en-US": "Alpha" },
              stars: 6,
              defaultVariant: "900001",
              skins: [
                { variantId: "900001", type: "default", name: null, nameEn: null },
                { variantId: "900098", type: "insight", name: "洞悉", nameEn: "Insight" },
              ],
            },
          ],
          skins: [],
        }),
      ),
    /Unsupported primary catch-up for character 9000: admitted insight 900098 competes with primary 900002/,
    "a supplement character demoted by primary catch-up also stops the build",
  );

  const admissionCatalog = parseUttuCatalog(
    `<html><script>const T=[
{ID:9200,Name:"丙",Rarity:6,LocaleName:{en:"Gamma",zh:"丙"}},
{ID:9201,Name:"丁",Rarity:5,LocaleName:{en:"Delta",zh:"丁"}},
{ID:3029,Name:"Schneider",Rarity:5,LocaleName:{en:"Schneider",zh:"斯奈德"}},
{ID:9000,Name:"甲",Rarity:6,LocaleName:{en:"Alpha",zh:"甲"}}
];</script></html>`,
    `<html><script>const R=[
{profile:{ID:9200},garment:{id:920001,name:{en:"Default",zh:"Default"},category:"default"}},
{profile:{ID:9200},garment:{id:920002,name:{en:"Insight",zh:"洞悉"},category:"insight"}},
{profile:{ID:9200},garment:{id:920003,name:{en:"Outfit",zh:"衣裝"},category:"basic"}},
{profile:{ID:9201},garment:{id:920101,name:{en:"Insight only",zh:"洞悉"},category:"insight"}},
{profile:{ID:3029},garment:{id:302901,name:{en:"Default",zh:"Default"},category:"default"}},
{profile:{ID:9000},garment:{id:900001,name:{en:"Default",zh:"Default"},category:"default"}},
{profile:{ID:9000},garment:{id:900004,name:{en:"Known outfit",zh:"既有衣裝"},category:"advanced"}},
{profile:{ID:9000},garment:{id:900005,name:{en:"Insight placeholder",zh:"洞悉"},category:"insight"}}
];</script></html>`,
  );
  const plan = planUttuAdmissions({
    catalog: admissionCatalog,
    arcanists: primary,
    supplement: emptyUttuSupplement(),
    excludedBaseIds: new Set(["3029"]),
    ignoredVariantIds: new Set(),
  });
  assert.deepEqual(
    plan.newCharacters.map((character) => [
      character.baseId,
      character.defaultVariant,
      character.skins.map((skin) => skin.variantId),
    ]),
    [["9200", "920001", ["920001", "920002", "920003"]]],
    "only a fully mapped new character with one explicit default is planned",
  );
  assert.deepEqual(
    plan.skins.map((skin) => skin.variantId),
    ["900004"],
    "a known character receives only real Skin Variants, never default/insight placeholders",
  );
  assert.ok(
    plan.pending.some((entry) => entry.baseId === "9201" && entry.reason.includes("single explicit default")),
    "a new character without an explicit default stays pending",
  );
  assert.ok(
    !plan.diagnostics.some((entry) => entry.includes("3029")),
    "catalog-policy excluded characters are never planned",
  );
  assert.deepEqual(
    collectPlannedVariantIds(plan),
    ["900004", "920001", "920002", "920003"],
    "planned Variant IDs are the exact image set an admission needs",
  );

  const ignoredStubPlan = planUttuAdmissions({
    catalog: admissionCatalog,
    arcanists: primary,
    supplement: emptyUttuSupplement(),
    excludedBaseIds: new Set(),
    ignoredVariantIds: new Set(["900004"]),
  });
  assert.deepEqual(
    ignoredStubPlan.skins,
    [],
    "a catalog-policy ignored CN skin stub is never admitted",
  );

  const realLegacyTypeDisagreements = [
    ["3012", "301202"],
    ["3027", "302702"],
    ["3030", "303002"],
    ["3035", "303502"],
    ["3036", "303602"],
    ["3040", "304002"],
    ["3050", "305002"],
    ["3055", "305502"],
    ["3096", "309602"],
  ] as const;
  const legacyTypedArcanists: ArcanistEntryFull[] =
    realLegacyTypeDisagreements.map(([baseId, variantId]) => ({
      id: Number(baseId),
      name: `CN ${baseId}`,
      nameEng: `EN ${baseId}`,
      live2d: [
        {
          id: `${baseId}01`,
          name: "",
          nameEng: "",
          des: "初始皮肤",
          characterSkin: "",
          characterSkinNameEng: "",
        },
        {
          id: variantId,
          name: "衣裝",
          nameEng: "Garment",
          des: "衣裝",
          characterSkin: "衣裝",
          characterSkinNameEng: "Garment",
        },
      ],
    }));
  const legacyProfilesHtml = `<html><script>const T=[${realLegacyTypeDisagreements
    .map(
      ([baseId]) =>
        `{ID:${baseId},Name:"CN ${baseId}",Rarity:5,LocaleName:{zh:"CN ${baseId}",en:"EN ${baseId}"}}`,
    )
    .join(",")}];</script></html>`;
  const legacyGarmentsHtml = `<html><script>const R=[${realLegacyTypeDisagreements
    .map(
      ([baseId, variantId]) =>
        `{profile:{ID:${baseId}},garment:{id:${variantId},name:{en:"Garment",zh:"衣裝"},category:"basic"}}`,
    )
    .join(",")}];</script></html>`;
  const legacyPlan = planUttuAdmissions({
    catalog: parseUttuCatalog(legacyProfilesHtml, legacyGarmentsHtml),
    arcanists: legacyTypedArcanists,
    supplement: emptyUttuSupplement(),
    excludedBaseIds: new Set(),
    ignoredVariantIds: new Set(),
  });
  assert.deepEqual(
    legacyPlan.skins,
    [],
    "primary ownership wins over a category disagreement on an already-owned exact ID",
  );
  assert.deepEqual(
    legacyPlan.newCharacters,
    [],
    "the legacy-typed primary rows are not re-admitted as new characters",
  );

  const crossOwnerCatalog = parseUttuCatalog(
    `<html><script>const T=[{ID:9001,Name:"乙",Rarity:5,LocaleName:{zh:"乙",en:"Beta"}}];</script></html>`,
    `<html><script>const R=[{profile:{ID:9001},garment:{id:900001,name:{en:"Garment",zh:"衣裝"},category:"basic"}}];</script></html>`,
  );
  assert.throws(
    () =>
      planUttuAdmissions({
        catalog: crossOwnerCatalog,
        arcanists: primary,
        supplement: emptyUttuSupplement(),
        excludedBaseIds: new Set(),
        ignoredVariantIds: new Set(),
      }),
    /already owned by 9000; the refreshed source claims 9001/,
    "a cross-owner claim on a primary-owned exact ID stops the refresh",
  );

  const managedSupplement = parseUttuSupplement({
    ...validSupplement,
    characters: [],
    skins: [
      { baseId: "9000", variantId: "900003", type: "skin", name: "衣裝", nameEn: "Garment" },
    ],
  });
  const managedTypeChange = parseUttuCatalog(
    `<html><script>const T=[{ID:9000,Name:"甲",Rarity:5,LocaleName:{zh:"甲",en:"Alpha"}}];</script></html>`,
    `<html><script>const R=[{profile:{ID:9000},garment:{id:900003,name:{en:"Insight",zh:"洞悉"},category:"insight"}}];</script></html>`,
  );
  assert.throws(
    () =>
      planUttuAdmissions({
        catalog: managedTypeChange,
        arcanists: primary,
        supplement: managedSupplement,
        excludedBaseIds: new Set(),
        ignoredVariantIds: new Set(),
      }),
    /is admitted as skin; the refreshed source claims insight/,
    "a type change on a supplement-managed exact ID stops the refresh",
  );
  const catchUpPrimary = [
    arcanist(9000, [
      ["default", "900001"],
      ["insight", "900002"],
      ["skin", "900003"],
    ]),
  ];
  const caughtUp = mergeUttuSupplement(catchUpPrimary, managedSupplement);
  assert.deepEqual(caughtUp.returnedToPrimary, ["900003"]);
  assert.throws(
    () => planUttuAdmissions({
      catalog: managedTypeChange,
      arcanists: catchUpPrimary,
      supplement: caughtUp.supplement,
      managedAtStart: new Set(["900003"]),
      excludedBaseIds: new Set(),
      ignoredVariantIds: new Set(),
    }),
    /is admitted as skin; the refreshed source claims insight/,
    "a Variant returned to primary during this run still checks fetched type mutation",
  );

  const managedOwnerChange = parseUttuCatalog(
    `<html><script>const T=[{ID:9001,Name:"乙",Rarity:5,LocaleName:{zh:"乙",en:"Beta"}}];</script></html>`,
    `<html><script>const R=[{profile:{ID:9001},garment:{id:900003,name:{en:"Garment",zh:"衣裝"},category:"basic"}}];</script></html>`,
  );
  assert.throws(
    () =>
      planUttuAdmissions({
        catalog: managedOwnerChange,
        arcanists: primary,
        supplement: managedSupplement,
        excludedBaseIds: new Set(),
        ignoredVariantIds: new Set(),
      }),
    /already owned by 9000; the refreshed source claims 9001/,
    "an owner change on a supplement-managed exact ID stops the refresh",
  );

  const previous = parseUttuSupplement({
    ...validSupplement,
    characters: [],
    skins: [
      { baseId: "9000", variantId: "900009", type: "skin", name: "舊衣", nameEn: "Old" },
    ],
  });
  const missingImage = completeUttuAdmissions(previous, plan, new Set(["920001", "900004"]));
  assert.deepEqual(
    missingImage.supplement.characters,
    previous.characters,
    "a new character with a missing Variant image is not admitted",
  );
  assert.deepEqual(
    missingImage.supplement.skins.map((skin) => skin.variantId),
    ["900004", "900009"],
    "the fully imaged known Skin joins the retained prior rows",
  );
  assert.equal(missingImage.admittedSkins, 1, "the fully imaged known Skin is admitted");
  assert.ok(
    missingImage.pending.some((entry) => entry.baseId === "9200" && entry.reason.includes("920003")),
    "the missing exact image keeps the character pending",
  );
  const completeImages = completeUttuAdmissions(
    previous,
    plan,
    new Set(["900004", "920001", "920002", "920003"]),
  );
  assert.equal(completeImages.admittedCharacters, 1);
  assert.equal(completeImages.admittedSkins, 1);
  assert.deepEqual(
    completeImages.supplement.skins.map((skin) => skin.variantId),
    ["900004", "900009"],
    "admissions append to the validated supplement without dropping prior rows",
  );
  assert.deepEqual(
    completeImages.supplement.characters.map((character) => character.baseId),
    ["9200"],
    "a fully imaged new character is admitted",
  );

  const secondWaveCatalog = parseUttuCatalog(
    `<html><script>const T=[{ID:9200,Name:"丙",Rarity:6,LocaleName:{en:"Gamma",zh:"丙"}}];</script></html>`,
    `<html><script>const R=[
{profile:{ID:9200},garment:{id:920001,name:{en:"Default",zh:"Default"},category:"default"}},
{profile:{ID:9200},garment:{id:920002,name:{en:"Insight",zh:"洞悉"},category:"insight"}},
{profile:{ID:9200},garment:{id:920004,name:{en:"Second wave",zh:"第二件衣裝"},category:"basic"}}
];</script></html>`,
  );
  const secondWavePlan = planUttuAdmissions({
    catalog: secondWaveCatalog,
    arcanists: primary,
    supplement: completeImages.supplement,
    excludedBaseIds: new Set(),
    ignoredVariantIds: new Set(),
  });
  const secondWave = completeUttuAdmissions(
    completeImages.supplement,
    secondWavePlan,
    new Set(["920004"]),
  );
  assert.deepEqual(
    secondWave.supplement.characters.map((character) => [
      character.baseId,
      character.skins.map((skin) => skin.variantId),
    ]),
    [["9200", ["920001", "920002", "920003", "920004"]]],
    "a later garment joins the supplement-owned character instead of a forbidden standalone row",
  );
  assert.deepEqual(
    secondWave.supplement.skins.map((skin) => skin.variantId),
    ["900004", "900009"],
    "primary-owned characters keep using standalone Skin rows",
  );

  const safeFallback = fetchUttuCatalogSafely(() => {
    throw new UttuParseError("fixture parse failure");
  });
  assert.equal(safeFallback.catalog, null, "a parse failure keeps the last known good supplement");
  assert.match(safeFallback.warning ?? "", /previously admitted supplement/);
  assert.equal(
    fetchUttuCatalogSafely(() => {
      throw new UpstreamRefreshError("fixture transport failure");
    }).catalog,
    null,
    "a transport failure keeps the last known good supplement",
  );
  assert.equal(
    fetchUttuCatalogSafely(() => ({ profiles: [], garments: [], diagnostics: [], incompleteBaseIds: new Set() }))
      .catalog,
    null,
    "an empty extraction is an outage, not an empty catalog",
  );
  assert.throws(
    () =>
      fetchUttuCatalogSafely(() => {
        throw new Error("fixture programming failure");
      }),
    /fixture programming failure/,
    "a local programming failure is not treated as a secondary-source outage",
  );
  assert.equal(
    fetchUttuCatalogSafely(() => catalog).catalog,
    catalog,
    "a valid extraction is accepted",
  );

  const committedSupplement = loadUttuSupplement();
  const candidateFile = path.join(root, "uttu-supplement.staging-fixture.json");
  writeFileSync(candidateFile, JSON.stringify(previous, null, 2) + "\n");
  delete process.env.R1999_UTTU_SUPPLEMENT;
  assert.deepEqual(
    loadUttuSupplementForBuild(),
    committedSupplement,
    "a standalone build reads only the committed supplement",
  );
  process.env.R1999_UTTU_SUPPLEMENT = candidateFile;
  try {
    assert.deepEqual(
      loadUttuSupplementForBuild(),
      previous,
      "the pipeline build reads this run's candidate",
    );
  } finally {
    delete process.env.R1999_UTTU_SUPPLEMENT;
  }
  assertSupplementCandidateHash(candidateFile, {
    "uttu-supplement.json": createHash("sha256")
      .update(readFileSync(candidateFile))
      .digest("hex"),
  });
  assert.throws(
    () =>
      assertSupplementCandidateHash(candidateFile, {
        "uttu-supplement.json": "0".repeat(64),
      }),
    /changed after build:source/,
    "a candidate that differs from the composed hash is refused",
  );
  assert.throws(
    () => assertSupplementCandidateHash(candidateFile, {}),
    /did not consume this run's UTTU supplement candidate/,
    "a candidate the catalog source never consumed is refused",
  );
  assert.throws(
    () => assertSupplementInstalled(previous, new Set(["900004"])),
    /Variants are not installed: 900009/,
    "a candidate Variant missing from the staged install set blocks promotion",
  );
  assertSupplementInstalled(previous, new Set(["900009"]));
  const promoteTarget = path.join(root, "uttu-supplement.committed.json");
  assert.equal(
    promoteUttuSupplement(candidateFile, promoteTarget),
    true,
    "an installed candidate is promoted into the committed snapshot",
  );
  assert.deepEqual(
    loadUttuSupplement(promoteTarget),
    previous,
    "promotion moves exactly the validated candidate",
  );
  assert.equal(
    promoteUttuSupplement(candidateFile, promoteTarget),
    false,
    "a candidate cannot be promoted twice",
  );

  const headiconDir = path.join(root, "headicons");
  const opaqueHeadicon = path.join(root, "opaque.webp");
  await writeWebp(opaqueHeadicon, 136, 136);
  await validateUttuHeadicon(opaqueHeadicon);
  const transparentHeadicon = path.join(root, "transparent.webp");
  await writeWebp(transparentHeadicon, 136, 136, { alpha: 0 });
  await assert.rejects(
    () => validateUttuHeadicon(transparentHeadicon),
    /fully transparent/,
    "a fully transparent small headicon is rejected",
  );
  const lossyHeadicon = path.join(root, "lossy.webp");
  await writeWebp(lossyHeadicon, 136, 136, { lossless: false });
  await assert.rejects(
    () => validateUttuHeadicon(lossyHeadicon),
    /not a lossless WebP image/,
    "a lossy small headicon is rejected",
  );
  const wrongSizeHeadicon = path.join(root, "wrong-size.webp");
  await writeWebp(wrongSizeHeadicon, 128, 128);
  await assert.rejects(
    () => validateUttuHeadicon(wrongSizeHeadicon),
    /not a 136-144px square headicon/,
    "a small headicon outside the 136-144px square bounds is rejected",
  );
  assert.equal(
    hasLosslessWebpChunk(Buffer.from("not a webp file")),
    false,
    "a non-WebP payload never passes the lossless gate",
  );

  let requestedUrl = "";
  assert.equal(
    await cacheUttuHeadicon("930001", headiconDir, (url, output) => {
      requestedUrl = url;
      copyFileSync(opaqueHeadicon, output);
    }),
    true,
    "a validated supplemental headicon is cached",
  );
  assert.equal(
    requestedUrl,
    "https://assets.merui.net/headicon_small/930001.webp",
    "supplemental headicons come from the small endpoint",
  );
  assert.equal(
    await hasValidUttuHeadicon(path.join(headiconDir, "930001.webp")),
    true,
    "cached supplemental bytes stay validated",
  );
  assert.equal(
    await cacheUttuHeadicon("930002", headiconDir, () => {
      throw new UpstreamRefreshError("fixture 404");
    }),
    false,
    "an unavailable upstream headicon is reported instead of cached",
  );
  assert.equal(
    await hasValidUttuHeadicon(path.join(headiconDir, "930002.webp")),
    false,
    "an unavailable headicon leaves no cache entry",
  );
  for (const [variantId, source] of [
    ["930003", lossyHeadicon],
    ["930004", wrongSizeHeadicon],
  ] as const) {
    assert.equal(
      await cacheUttuHeadicon(variantId, headiconDir, (_url, output) => {
        copyFileSync(source, output);
      }),
      false,
      `an unusable downloaded headicon (${variantId}) is unavailable, not a pipeline failure`,
    );
    assert.equal(
      await hasValidUttuHeadicon(path.join(headiconDir, `${variantId}.webp`)),
      false,
      "a rejected download leaves no cache entry",
    );
  }
  assert.equal(
    await cacheUttuHeadicon("930005", headiconDir, (_url, output) => {
      writeFileSync(output, "<html>blocked</html>");
    }),
    false,
    "an HTML payload from the image endpoint is an unusable candidate, not an outage",
  );
  await assert.rejects(
    () =>
      cacheUttuHeadicon("930006", headiconDir, () => {
        // A download that produces no local file is a local failure, not a bad candidate.
      }),
    /ENOENT/,
    "a local read failure still aborts instead of being classified as an unusable image",
  );

  console.log("UTTU supplement regressions: passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => rmSync(root, { recursive: true, force: true }));
