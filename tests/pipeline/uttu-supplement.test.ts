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
import { describe, it } from "node:test";
import { composeCatalogSource } from "../../scripts/catalog-composition";
import { buildSkins, type ArcanistEntryFull } from "../../scripts/skin-utils";
import { UpstreamRefreshError } from "../../scripts/sync-refresh";
import { fetchUttuCatalogSafely } from "../../scripts/sync-uttu";
import {
  cacheUttuHeadicon,
  hasValidUttuHeadicon,
  validateUttuHeadicon,
} from "../../scripts/uttu-images";
import {
  parseUttuCatalog,
  UttuOwnershipConflictError,
  UttuParseError,
} from "../../scripts/uttu-parser";
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
} from "../../scripts/uttu-supplement";
import {
  makeArcanistSkin,
  makeEmptyLanguages,
  makeEmptyPolicy,
  writeTestWebp,
} from "../helpers/pipeline-fixtures";

function makePrimaryArcanist(
  id: number,
  variants: Array<["default" | "insight" | "skin", string]>,
): ArcanistEntryFull {
  return {
    id,
    name: `CN ${id}`,
    nameEng: `EN ${id}`,
    live2d: variants.map(([type, variantId]) =>
      makeArcanistSkin(variantId, {
        des:
          type === "default" ? "初始皮肤" : type === "insight" ? "进阶皮肤" : "",
      }),
    ),
  };
}

const profilesHtml = `<html><script>const T=[{ID:9001,Name:"甲",Rarity:6,LocaleName:{en:"Alpha",zh:"甲",tw:"N/A"}},{ID:9002,Name:"乙",Rarity:4,LocaleName:{en:"Beta",zh:"乙",jp:"ベータ"}}];</script></html>`;
const garmentsHtml = `<html><script>const R=[
{profile:{ID:9001,Name:"甲"},garment:{id:900101,name:{en:"Default",zh:"Default"},category:"default",version:4,global:!1}},
{profile:{ID:9001,Name:"甲"},garment:{id:900102,name:{en:"Insight",zh:"N/A"},category:"insight",version:4,global:!1}},
{profile:{ID:9001,Name:"甲"},garment:{id:900103,name:{en:"Skin",zh:"衣"},category:"advanced",version:4,global:!0}},
{profile:{ID:9002,Name:"乙"},garment:{id:900201,name:{en:"Default",zh:"Default"},category:"default"}},
{profile:{ID:9002,Name:"乙"},garment:{id:900202,name:{en:"N/A",zh:"N/A"},category:"basic"}}
];</script></html>`;

function makeValidSupplement(): UttuSupplement {
  return {
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
}

describe("UTTU catalog parser", () => {
  it("parses profiles & garments, strips release metadata, omits N/A, and marks incomplete rows", () => {
    const catalog = parseUttuCatalog(profilesHtml, garmentsHtml);
    assert.deepEqual(
      catalog.profiles.map((p) => p.baseId),
      [9001, 9002],
    );
    assert.deepEqual(catalog.profiles[0].names, { "zh-CN": "甲", "en-US": "Alpha" });
    assert.equal(catalog.profiles[1].names["ja-JP"], "ベータ");
    assert.deepEqual(
      catalog.garments.map((g) => [g.variantId, g.type, g.name, g.nameEn]),
      [
        ["900101", "default", null, null],
        ["900102", "insight", null, "Insight"],
        ["900103", "skin", "衣", "Skin"],
        ["900201", "default", null, null],
      ],
    );
    assert.deepEqual(Object.keys(catalog.garments[2]).sort(), [
      "baseId",
      "name",
      "nameEn",
      "type",
      "variantId",
    ]);
    assert.deepEqual([...catalog.incompleteBaseIds], [9002]);
  });

  it("rejects non-literal JS, empty pages, duplicate profiles, and cross-owner garment conflicts, while deduping identical rows", () => {
    assert.throws(
      () =>
        parseUttuCatalog(
          `<html><script>const T=[{ID:window.id,Name:"甲",Rarity:6,LocaleName:{zh:"甲"}}];</script></html>`,
          garmentsHtml,
        ),
      UttuParseError,
    );
    assert.throws(
      () => parseUttuCatalog("<html><body>no client data</body></html>", garmentsHtml),
      UttuParseError,
    );
    assert.throws(
      () =>
        parseUttuCatalog(
          `<html><script>const T=[{ID:9001,Name:"甲",Rarity:6,LocaleName:{zh:"甲"}},{ID:9001,Name:"甲",Rarity:6,LocaleName:{zh:"甲"}}];</script></html>`,
          garmentsHtml,
        ),
      /Duplicate UTTU profile ID: 9001/,
    );

    const deduped = parseUttuCatalog(
      profilesHtml,
      `<html><script>const R=[
{profile:{ID:9001},garment:{id:900101,name:{en:"One"},category:"basic"}},
{profile:{ID:9001},garment:{id:900101,name:{en:"One"},category:"basic"}},
{profile:{ID:9001},garment:{id:900102,name:{en:"Three"},category:"mystery"}}
];</script></html>`,
    );
    assert.deepEqual(
      deduped.garments.map((g) => g.variantId),
      ["900101"],
    );
    assert.deepEqual([...deduped.incompleteBaseIds], [9001]);

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
    );
  });
});

describe("UTTU supplement schema validation", () => {
  it("validates complete supplements and rejects bad schema, named/missing defaults, duplicates, and N/A names", () => {
    const valid = makeValidSupplement();
    assert.deepEqual(parseUttuSupplement(valid), valid);
    assert.throws(
      () => parseUttuSupplement({ ...valid, schemaVersion: 2 }),
      /schemaVersion/,
    );

    const namedDefault = structuredClone(valid);
    namedDefault.characters[0].skins[0].name = "初始";
    assert.throws(
      () => parseUttuSupplement(namedDefault),
      /must not carry garment names/,
    );

    const missingDefault = structuredClone(valid);
    missingDefault.characters[0].skins = missingDefault.characters[0].skins.slice(1);
    assert.throws(
      () => parseUttuSupplement(missingDefault),
      /exactly one explicit default/,
    );

    const duplicateSkin = structuredClone(valid);
    duplicateSkin.skins = [
      { baseId: "9000", variantId: "900003", type: "skin", name: "一", nameEn: "One" },
      { baseId: "9001", variantId: "900003", type: "skin", name: "二", nameEn: "Two" },
    ];
    assert.throws(
      () => parseUttuSupplement(duplicateSkin),
      /Duplicate supplement Variant ID: 900003/,
    );

    const duplicateOfChar = structuredClone(valid);
    duplicateOfChar.skins.push({
      baseId: "9100",
      variantId: "910002",
      type: "skin",
      name: "重複",
      nameEn: "Duplicate",
    });
    assert.throws(
      () => parseUttuSupplement(duplicateOfChar),
      /duplicates its new character record/,
    );

    const naSkin = structuredClone(valid);
    naSkin.skins = [
      { baseId: "9100", variantId: "910003", type: "skin", name: "N/A", nameEn: null },
    ];
    assert.throws(() => parseUttuSupplement(naSkin), /empty or N\/A/);
  });
});

describe("mergeUttuSupplement & catalog composition integration", () => {
  const primary = [
    makePrimaryArcanist(9000, [
      ["default", "900001"],
      ["insight", "900002"],
    ]),
    makePrimaryArcanist(9001, [["default", "900101"]]),
  ];

  it("adapts star ratings to 0-based rare, lets primary CN/manual/fallback outrank UTTU, and passes CN skin gates", () => {
    const valid = makeValidSupplement();
    const mergedNew = mergeUttuSupplement(primary, valid);
    assert.deepEqual(mergedNew.characters, [
      { id: 9100, name: "甲", nameEng: "Alpha", rare: 5 },
    ]);
    assert.deepEqual(
      buildSkins(mergedNew.arcanists.find((e) => String(e.id) === "9100")!).map(
        (skin) => [skin.id, skin.type],
      ),
      [
        ["910001", "default"],
        ["910002", "insight"],
      ],
    );
    assert.deepEqual(
      mergedNew.arcanists.find((e) => String(e.id) === "9000"),
      primary[0],
    );

    const compositionSupplement = parseUttuSupplement({
      ...valid,
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
    const merge = mergeUttuSupplement([], compositionSupplement);
    const composed = composeCatalogSource({
      arcanists: merge.arcanists,
      cnCharacters: mergeSupplementPackageCharacters(
        [
          { id: 9300, name: "可信CN正名", nameEng: "Trusted CN English", rare: 4 },
          { id: 9301, name: "", nameEng: "", rare: undefined },
        ],
        merge.characters,
      ),
      globalCharacters: [],
      cnSkins: merge.skins,
      globalSkins: [],
      cnEquips: [],
      globalEquips: [],
      languages: makeEmptyLanguages(),
      nameFallbacks: new Map([["9301", { "ja-JP": "Fallback日本語" }]]),
      nameOverrides: new Map([["9301", { "zh-TW": "Manual繁中" }]]),
      supplementNames: new Map(
        merge.supplement.characters.map((c) => [c.baseId, c.names]),
      ),
      policy: makeEmptyPolicy(),
      releaseClock: new Date("2026-01-01T00:00:00.000Z"),
    });

    const gamma = composed.characters.find((e) => e.baseId === "9300")!;
    const delta = composed.characters.find((e) => e.baseId === "9301")!;
    assert.equal(gamma.rarity, 4);
    assert.equal(delta.rarity, 5);
    assert.deepEqual(
      gamma.skins.map((s) => [s.id, s.type]),
      [
        ["930001", "default"],
        ["930002", "insight"],
      ],
    );
    assert.equal(gamma.names["zh-CN"], "可信CN正名");
    assert.equal(gamma.names["en-US"], "Trusted CN English");
    assert.equal(gamma.names["ja-JP"], "UTTU日本語");
    assert.equal(delta.names["zh-CN"], "丁");
    assert.equal(delta.names["en-US"], "Delta");
    assert.equal(delta.names["ja-JP"], "Fallback日本語");
    assert.equal(delta.names["zh-TW"], "Manual繁中");
  });

  it("appends standalone skins, returns caught-up Variants to primary, and aborts on type/owner/slot conflicts", () => {
    const base = makeValidSupplement();
    const skinOnly = parseUttuSupplement({
      ...base,
      characters: [],
      skins: [
        { baseId: "9000", variantId: "900003", type: "skin", name: "新衣", nameEn: "New" },
      ],
    });
    const mergedSkin = mergeUttuSupplement(primary, skinOnly);
    assert.deepEqual(mergedSkin.skins, [{ id: 900003, characterId: 9000 }]);
    assert.deepEqual(
      buildSkins(mergedSkin.arcanists.find((e) => String(e.id) === "9000")!).map(
        (s) => [s.id, s.type, s.name],
      ),
      [
        ["900001", "default", undefined],
        ["900002", "insight", undefined],
        ["900003", "skin", "新衣"],
      ],
    );

    const returned = mergeUttuSupplement(
      primary,
      parseUttuSupplement({
        ...base,
        characters: [],
        skins: [
          { baseId: "9000", variantId: "900002", type: "insight", name: "洞悉", nameEn: "Insight" },
        ],
      }),
    );
    assert.deepEqual(returned.returnedToPrimary, ["900002"]);
    assert.deepEqual(returned.supplement.skins, []);
    assert.deepEqual(
      buildSkins(returned.arcanists.find((e) => String(e.id) === "9000")!),
      buildSkins(primary[0]),
    );

    assert.throws(
      () =>
        mergeUttuSupplement(
          primary,
          parseUttuSupplement({
            ...base,
            characters: [],
            skins: [
              { baseId: "9000", variantId: "900002", type: "skin", name: "類型", nameEn: "Type" },
            ],
          }),
        ),
      /type skin conflicts with primary type insight/,
    );
    assert.throws(
      () =>
        mergeUttuSupplement(
          primary,
          parseUttuSupplement({
            ...base,
            characters: [],
            skins: [
              { baseId: "9000", variantId: "900101", type: "skin", name: "別人的", nameEn: "Other" },
            ],
          }),
        ),
      /owned by primary character 9001, not 9000/,
    );
    assert.throws(
      () =>
        mergeUttuSupplement(
          primary,
          parseUttuSupplement({
            ...base,
            characters: [],
            skins: [
              { baseId: "9000", variantId: "900099", type: "insight", name: "洞悉", nameEn: "Insight" },
            ],
          }),
        ),
      /admitted insight 900099 competes with primary 900002/,
    );
  });
});

describe("UTTU admission planning & completion", () => {
  const primary = [
    makePrimaryArcanist(9000, [
      ["default", "900001"],
      ["insight", "900002"],
    ]),
    makePrimaryArcanist(9001, [["default", "900101"]]),
  ];

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

  it("plans complete new characters and real skins for known characters while respecting policy exclusions, image gates, and second-wave skins", () => {
    const plan = planUttuAdmissions({
      catalog: admissionCatalog,
      arcanists: primary,
      supplement: emptyUttuSupplement(),
      excludedBaseIds: new Set(["3029"]),
      ignoredVariantIds: new Set(),
    });
    assert.deepEqual(
      plan.newCharacters.map((c) => [
        c.baseId,
        c.defaultVariant,
        c.skins.map((s) => s.variantId),
      ]),
      [["9200", "920001", ["920001", "920002", "920003"]]],
    );
    assert.deepEqual(
      plan.skins.map((s) => s.variantId),
      ["900004"],
    );
    assert.ok(
      plan.pending.some(
        (entry) =>
          entry.baseId === "9201" && entry.reason.includes("single explicit default"),
      ),
    );
    assert.equal(plan.diagnostics.some((entry) => entry.includes("3029")), false);
    assert.deepEqual(collectPlannedVariantIds(plan), [
      "900004",
      "920001",
      "920002",
      "920003",
    ]);

    const ignoredStubPlan = planUttuAdmissions({
      catalog: admissionCatalog,
      arcanists: primary,
      supplement: emptyUttuSupplement(),
      excludedBaseIds: new Set(),
      ignoredVariantIds: new Set(["900004"]),
    });
    assert.deepEqual(ignoredStubPlan.skins, []);

    const previous = parseUttuSupplement({
      ...makeValidSupplement(),
      characters: [],
      skins: [
        { baseId: "9000", variantId: "900009", type: "skin", name: "舊衣", nameEn: "Old" },
      ],
    });

    // Missing Variant image keeps new character pending while admitting imaged Skin
    const partial = completeUttuAdmissions(
      previous,
      plan,
      new Set(["920001", "900004"]),
    );
    assert.deepEqual(partial.supplement.characters, []);
    assert.deepEqual(
      partial.supplement.skins.map((s) => s.variantId),
      ["900004", "900009"],
    );
    assert.ok(
      partial.pending.some(
        (entry) => entry.baseId === "9200" && entry.reason.includes("920003"),
      ),
    );

    const complete = completeUttuAdmissions(
      previous,
      plan,
      new Set(["900004", "920001", "920002", "920003"]),
    );
    assert.equal(complete.admittedCharacters, 1);
    assert.equal(complete.admittedSkins, 1);
    assert.deepEqual(
      complete.supplement.characters.map((c) => c.baseId),
      ["9200"],
    );

    // Second-wave garment joins the supplement-owned character record
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
      supplement: complete.supplement,
      excludedBaseIds: new Set(),
      ignoredVariantIds: new Set(),
    });
    const secondWave = completeUttuAdmissions(
      complete.supplement,
      secondWavePlan,
      new Set(["920004"]),
    );
    assert.deepEqual(
      secondWave.supplement.characters.map((c) => [
        c.baseId,
        c.skins.map((s) => s.variantId),
      ]),
      [["9200", ["920001", "920002", "920003", "920004"]]],
    );
    assert.deepEqual(
      secondWave.supplement.skins.map((s) => s.variantId),
      ["900004", "900009"],
    );
  });

  it("dedupes primary-owned legacy type disagreements while aborting on cross-owner or managed-Variant conflicts", () => {
    const legacyArcanists: ArcanistEntryFull[] = [
      {
        id: 3012,
        name: "CN 3012",
        nameEng: "EN 3012",
        live2d: [
          makeArcanistSkin("301201", { des: "初始皮肤" }),
          makeArcanistSkin("301202", { name: "衣裝", des: "衣裝" }),
        ],
      },
    ];
    const legacyPlan = planUttuAdmissions({
      catalog: parseUttuCatalog(
        `<html><script>const T=[{ID:3012,Name:"CN 3012",Rarity:5,LocaleName:{zh:"CN 3012",en:"EN 3012"}}];</script></html>`,
        `<html><script>const R=[{profile:{ID:3012},garment:{id:301202,name:{en:"Garment",zh:"衣裝"},category:"basic"}}];</script></html>`,
      ),
      arcanists: legacyArcanists,
      supplement: emptyUttuSupplement(),
      excludedBaseIds: new Set(),
      ignoredVariantIds: new Set(),
    });
    assert.deepEqual(legacyPlan.skins, []);
    assert.deepEqual(legacyPlan.newCharacters, []);

    // Cross-owner claim on primary-owned ID aborts
    assert.throws(
      () =>
        planUttuAdmissions({
          catalog: parseUttuCatalog(
            `<html><script>const T=[{ID:9001,Name:"乙",Rarity:5,LocaleName:{zh:"乙",en:"Beta"}}];</script></html>`,
            `<html><script>const R=[{profile:{ID:9001},garment:{id:900001,name:{en:"Garment",zh:"衣裝"},category:"basic"}}];</script></html>`,
          ),
          arcanists: primary,
          supplement: emptyUttuSupplement(),
          excludedBaseIds: new Set(),
          ignoredVariantIds: new Set(),
        }),
      /already owned by 9000; the refreshed source claims 9001/,
    );

    // Variant returned to primary during this run still checks refreshed type mutation
    const managedSupplement = parseUttuSupplement({
      ...makeValidSupplement(),
      characters: [],
      skins: [
        { baseId: "9000", variantId: "900003", type: "skin", name: "衣裝", nameEn: "Garment" },
      ],
    });
    const catchUpPrimary = [
      makePrimaryArcanist(9000, [
        ["default", "900001"],
        ["insight", "900002"],
        ["skin", "900003"],
      ]),
    ];
    const caughtUp = mergeUttuSupplement(catchUpPrimary, managedSupplement);
    assert.deepEqual(caughtUp.returnedToPrimary, ["900003"]);
    assert.throws(
      () =>
        planUttuAdmissions({
          catalog: parseUttuCatalog(
            `<html><script>const T=[{ID:9000,Name:"甲",Rarity:5,LocaleName:{zh:"甲",en:"Alpha"}}];</script></html>`,
            `<html><script>const R=[{profile:{ID:9000},garment:{id:900003,name:{en:"Insight",zh:"洞悉"},category:"insight"}}];</script></html>`,
          ),
          arcanists: catchUpPrimary,
          supplement: caughtUp.supplement,
          managedAtStart: new Set(["900003"]),
          excludedBaseIds: new Set(),
          ignoredVariantIds: new Set(),
        }),
      /is admitted as skin; the refreshed source claims insight/,
    );

    // Owner change on supplement-managed ID aborts
    assert.throws(
      () =>
        planUttuAdmissions({
          catalog: parseUttuCatalog(
            `<html><script>const T=[{ID:9001,Name:"乙",Rarity:5,LocaleName:{zh:"乙",en:"Beta"}}];</script></html>`,
            `<html><script>const R=[{profile:{ID:9001},garment:{id:900003,name:{en:"Garment",zh:"衣裝"},category:"basic"}}];</script></html>`,
          ),
          arcanists: primary,
          supplement: managedSupplement,
          excludedBaseIds: new Set(),
          ignoredVariantIds: new Set(),
        }),
      /already owned by 9000; the refreshed source claims 9001/,
    );
  });
});

describe("UTTU safe fetch, staging promotion & headicon validation", () => {
  it("falls back on parse failure, rethrows programming errors, and enforces candidate hash/install/promotion gates", () => {
    const catalog = parseUttuCatalog(profilesHtml, garmentsHtml);
    const safeFallback = fetchUttuCatalogSafely(() => {
      throw new UttuParseError("fixture parse failure");
    });
    assert.equal(safeFallback.catalog, null);
    assert.match(safeFallback.warning ?? "", /previously admitted supplement/);
    assert.throws(
      () =>
        fetchUttuCatalogSafely(() => {
          throw new Error("fixture programming failure");
        }),
      /fixture programming failure/,
    );
    assert.equal(fetchUttuCatalogSafely(() => catalog).catalog, catalog);

    const root = mkdtempSync(path.join(tmpdir(), "r1999-uttu-promote-"));
    const previousEnv = process.env.R1999_UTTU_SUPPLEMENT;
    try {
      const candidateData = parseUttuSupplement({
        ...makeValidSupplement(),
        characters: [],
        skins: [
          { baseId: "9000", variantId: "900009", type: "skin", name: "舊衣", nameEn: "Old" },
        ],
      });
      const candidateFile = path.join(root, "uttu-supplement.staging.json");
      writeFileSync(candidateFile, JSON.stringify(candidateData, null, 2) + "\n");

      delete process.env.R1999_UTTU_SUPPLEMENT;
      assert.deepEqual(loadUttuSupplementForBuild(), loadUttuSupplement());

      process.env.R1999_UTTU_SUPPLEMENT = candidateFile;
      assert.deepEqual(loadUttuSupplementForBuild(), candidateData);

      const candidateHash = createHash("sha256")
        .update(readFileSync(candidateFile))
        .digest("hex");
      assertSupplementCandidateHash(candidateFile, {
        "uttu-supplement.json": candidateHash,
      });
      assert.throws(
        () =>
          assertSupplementCandidateHash(candidateFile, {
            "uttu-supplement.json": "0".repeat(64),
          }),
        /changed after build:source/,
      );
      assert.throws(
        () => assertSupplementCandidateHash(candidateFile, {}),
        /did not consume this run's UTTU supplement candidate/,
      );

      assert.throws(
        () => assertSupplementInstalled(candidateData, new Set(["900004"])),
        /Variants are not installed: 900009/,
      );
      assertSupplementInstalled(candidateData, new Set(["900009"]));

      const promoteTarget = path.join(root, "uttu-supplement.committed.json");
      assert.equal(promoteUttuSupplement(candidateFile, promoteTarget), true);
      assert.deepEqual(loadUttuSupplement(promoteTarget), candidateData);
      assert.equal(promoteUttuSupplement(candidateFile, promoteTarget), false);
    } finally {
      if (previousEnv === undefined) delete process.env.R1999_UTTU_SUPPLEMENT;
      else process.env.R1999_UTTU_SUPPLEMENT = previousEnv;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("validates lossless 136-144px square non-transparent headicons and caches only valid images", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "r1999-uttu-headicons-"));
    try {
      const headiconDir = path.join(root, "headicons");
      const opaque = path.join(root, "opaque.webp");
      const transparent = path.join(root, "transparent.webp");
      const lossy = path.join(root, "lossy.webp");
      const wrongSize = path.join(root, "wrong-size.webp");

      await writeTestWebp(opaque, 136, 136);
      await writeTestWebp(transparent, 136, 136, { alpha: 0 });
      await writeTestWebp(lossy, 136, 136, { lossless: false });
      await writeTestWebp(wrongSize, 128, 128);

      await validateUttuHeadicon(opaque);
      await assert.rejects(() => validateUttuHeadicon(transparent), /fully transparent/);
      await assert.rejects(() => validateUttuHeadicon(lossy), /not a lossless WebP image/);
      await assert.rejects(
        () => validateUttuHeadicon(wrongSize),
        /not a 136-144px square headicon/,
      );

      let requestedUrl = "";
      assert.equal(
        await cacheUttuHeadicon("930001", headiconDir, (url, output) => {
          requestedUrl = url;
          copyFileSync(opaque, output);
        }),
        true,
      );
      assert.equal(
        requestedUrl,
        "https://assets.merui.net/headicon_small/930001.webp",
      );
      assert.equal(
        await hasValidUttuHeadicon(path.join(headiconDir, "930001.webp")),
        true,
      );

      assert.equal(
        await cacheUttuHeadicon("930002", headiconDir, () => {
          throw new UpstreamRefreshError("fixture 404");
        }),
        false,
      );
      assert.equal(
        await hasValidUttuHeadicon(path.join(headiconDir, "930002.webp")),
        false,
      );

      assert.equal(
        await cacheUttuHeadicon("930005", headiconDir, (_url, output) => {
          writeFileSync(output, "<html>blocked</html>");
        }),
        false,
      );

      await assert.rejects(
        () => cacheUttuHeadicon("930006", headiconDir, () => {}),
        /ENOENT/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
