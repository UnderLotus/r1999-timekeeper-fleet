import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composeCatalogSource,
  type CatalogCompositionInput,
  type CatalogLanguageTables,
  type Equip,
  type PackageCharacter,
} from "../../scripts/catalog-composition";
import type { CatalogPolicy } from "../../scripts/catalog-policy";
import {
  isCompleteSourceCharacter,
  type SourceCharacter,
} from "../../scripts/catalog-source";
import { buildSkins, type ArcanistEntryFull } from "../../scripts/skin-utils";
import {
  makeArcanist,
  makeArcanistSkin,
  makeEmptyLanguages,
  makeEmptyPolicy,
} from "../helpers/pipeline-fixtures";

function validSourceCharacter(baseId = "9000"): SourceCharacter {
  return {
    id: baseId,
    baseId,
    names: {
      "zh-CN": "中文",
      "zh-TW": "繁中",
      "en-US": "English",
      "ja-JP": "日本語",
      "ko-KR": "한국어",
    },
    rarity: 5,
    maxInsight: 3,
    defaultVariant: `${baseId}01`,
    glReleased: false,
    skins: [
      { id: `${baseId}01`, type: "default" },
      { id: `${baseId}02`, type: "insight", name: "", nameEn: "" },
      {
        id: `${baseId}03`,
        type: "skin",
        name: "Skin",
        nameEn: "Skin",
        glPresent: false,
      },
    ],
  };
}

describe("catalog source validation", () => {
  it("requires canonical zh-CN and valid optional locales, unique variant IDs, and skin-only glPresent", () => {
    const valid = validSourceCharacter();
    for (const [names, expected] of [
      [valid.names, true],
      [{ "zh-CN": "中文" }, true],
      [{ ...valid.names, "zh-CN": " \t" }, false],
      [{ ...valid.names, "ja-JP": "" }, false],
      [{ ...valid.names, "ko-KR": 7 }, false],
      [{ "en-US": "English" }, false],
    ] as const) {
      assert.equal(
        isCompleteSourceCharacter({ ...valid, names }),
        expected,
        JSON.stringify(names),
      );
    }

    const malformedSkinName = structuredClone(valid);
    (malformedSkinName.skins[2] as Record<string, unknown>).name = 123;
    assert.equal(isCompleteSourceCharacter(malformedSkinName), false);

    const blankOptionalTranslations = structuredClone(valid);
    blankOptionalTranslations.skins[1].name = "";
    blankOptionalTranslations.skins[1].nameEn = "";
    assert.equal(isCompleteSourceCharacter(blankOptionalTranslations), true);

    const duplicateVariant = structuredClone(valid);
    duplicateVariant.skins.push({ ...duplicateVariant.skins[2] });
    assert.equal(isCompleteSourceCharacter(duplicateVariant), false);

    const defaultWithGlPresent = structuredClone(valid) as SourceCharacter & {
      skins: Array<Record<string, unknown>>;
    };
    defaultWithGlPresent.skins[0].glPresent = false;
    assert.equal(isCompleteSourceCharacter(defaultWithGlPresent), false);
  });
});

describe("catalog composition", () => {
  it("classifies Variant metadata before legacy suffixes and keeps opaque IDs as Skins", () => {
    const skins = buildSkins({
      id: 4100,
      name: "metadata",
      nameEng: "metadata",
      live2d: [
        makeArcanistSkin(410001, { des: "进阶皮肤" }),
        makeArcanistSkin(410002, { des: "初始皮肤" }),
        makeArcanistSkin(41000001),
      ],
    });
    assert.deepEqual(
      skins.map((skin) => [skin.id, skin.type]),
      [
        ["410001", "insight"],
        ["410002", "default"],
        ["41000001", "skin"],
      ],
    );
  });

  it("composes characters, opaque Variants, Global release timestamps, psychubes, and policy exclusions", () => {
    const arcanists = [
      makeArcanist(1001, "CN One", "CN One English", [100101, 100102, 100103]),
      makeArcanist(1002, "CN Two", "CN Two English", [100201]),
      makeArcanist(3066, "37", "Thirty-seven", [
        makeArcanistSkin(306601, { name: "37", nameEng: "Thirty-seven" }),
        makeArcanistSkin(30660001, {
          name: "37的往日",
          nameEng: "Portrait of the Past",
          characterSkin: "37的往日",
          characterSkinNameEng: "Portrait of the Past",
        }),
      ]),
      makeArcanist(9999, "Excluded", "Excluded English", [999901]),
    ];
    const cnCharacters: PackageCharacter[] = [
      { id: 1001, name: "CN One", nameEng: "CN One English", rare: 4 },
      { id: 1002, name: "CN Two", nameEng: "CN Two English", rare: 3 },
      { id: 3066, name: "37", nameEng: "Thirty-seven", rare: 6 },
      { id: 9999, name: "Excluded", nameEng: "Excluded English", rare: 5 },
    ];
    const globalCharacters: PackageCharacter[] = [
      {
        id: 1001,
        name: "global-key",
        nameEng: "Global One English",
        rare: 5,
        isOnline: "2026-09-03 04:59:59",
      },
    ];
    const cnSkins = [
      { id: 100101, characterId: 1001 },
      { id: 100102, characterId: 1001 },
      { id: 100103, characterId: 1001 },
      { id: 100201, characterId: 1002 },
      { id: 306601, characterId: 3066 },
      { id: 30660001, characterId: 3066 },
      { id: 999901, characterId: 9999 },
    ];
    const cnEquips: Equip[] = [
      { id: 2001, name: "cn-cube", name_en: "CN Cube", icon: "", rare: 5 },
      { id: 2002, name: "excluded", name_en: "Excluded", icon: "", rare: 5 },
      { id: 2003, name: "exp", name_en: "EXP", icon: "", rare: 5, isExpEquip: 1 },
      { id: 2004, name: "refine", name_en: "Refine", icon: "", rare: 5, isSpRefine: 1 },
      { id: 2005, name: "test", name_en: "Just Test", icon: "", rare: 5 },
      { id: 2006, name: "cn-only", name_en: "CN Only", icon: "", rare: 4 },
    ];
    const globalEquips: Equip[] = [
      { id: 2001, name: "global-cube", name_en: "Global Cube", icon: "", rare: 6 },
      { id: 2007, name: "global-only", name_en: "Global Only", icon: "", rare: 5 },
      { id: 2008, name: "untranslated", name_en: "English Only", icon: "", rare: 5 },
    ];
    const languages: CatalogLanguageTables = {
      ...makeEmptyLanguages(),
      "zh-CN": { "global-key": "全球一", "global-only": "Global 独立" },
      "en-US": { "global-key": "Global One", "global-only": "Global Only" },
    };
    const policy: CatalogPolicy = {
      ...makeEmptyPolicy(),
      excludedCharacters: [{ baseId: "9999", reason: "fixture exclusion" }],
      excludedPsychubes: [{ id: "2002", reason: "fixture exclusion" }],
    };

    const result = composeCatalogSource({
      arcanists,
      cnCharacters,
      globalCharacters,
      cnSkins,
      globalSkins: [{ id: 100103 }],
      cnEquips,
      globalEquips,
      languages,
      nameFallbacks: new Map([
        ["1001", { "en-US": "Fallback One", "ja-JP": "Fallback Japanese" }],
        ["1002", { "en-US": "Fallback Two" }],
      ]),
      nameOverrides: new Map([["1001", { "ja-JP": "Manual Japanese" }]]),
      policy,
      releaseClock: new Date("2026-09-03T10:00:00.000Z"),
      globalUtcOffsetMinutes: -5 * 60,
    });

    const one = result.characters.find((entry) => entry.baseId === "1001")!;
    assert.equal(one.names["zh-CN"], "全球一");
    assert.equal(one.names["en-US"], "Global One");
    assert.equal(one.names["ja-JP"], "Manual Japanese");
    assert.equal(one.glReleased, true);
    assert.equal(one.rarity, 5);
    assert.equal(one.maxInsight, 3);
    const oneGarment = one.skins.find((skin) => skin.id === "100103")!;
    const oneDefault = one.skins.find((skin) => skin.id === "100101")!;
    assert.equal(oneGarment.type, "skin");
    assert.equal(oneGarment.glPresent, true);
    assert.equal("glPresent" in oneDefault, false);

    const two = result.characters.find((entry) => entry.baseId === "1002")!;
    assert.equal(two.names["zh-CN"], "CN Two");
    assert.equal(two.names["en-US"], "Fallback Two");
    assert.equal(two.rarity, 3);
    assert.equal(two.maxInsight, 2);
    assert.equal(two.glReleased, false);

    // Opaque 8-digit Variant ID stays owned unreleased Skin
    const thirtySeven = result.characters.find((entry) => entry.baseId === "3066")!;
    const longVariant = thirtySeven.skins.find((skin) => skin.id === "30660001")!;
    assert.equal(longVariant.type, "skin");
    assert.equal(longVariant.glPresent, false);
    assert.equal(thirtySeven.defaultVariant, "306601");

    // Policy exclusions applied
    assert.equal(result.characters.some((entry) => entry.baseId === "9999"), false);
    assert.deepEqual(
      result.psychubes.map((entry) => entry.id),
      ["2001", "2006", "2007", "2008"],
    );
    assert.equal(result.psychubes.find((entry) => entry.id === "2001")?.glPresent, true);
    assert.equal(result.psychubes.find((entry) => entry.id === "2006")?.glPresent, false);
    assert.equal(
      result.psychubes.find((entry) => entry.id === "2007")?.names["zh-CN"],
      "Global 独立",
    );
    // Untranslated psychube omits zh-CN instead of borrowing English
    const untranslated = result.psychubes.find((entry) => entry.id === "2008")!;
    assert.equal("zh-CN" in untranslated.names, false);
    assert.equal(untranslated.names["en-US"], "English Only");
  });

  it("enforces same-locale precedence, LKG retention, placeholder skipping, and UTTU lookup-only semantics", () => {
    const nameHistory: SourceCharacter = {
      id: "7001",
      baseId: "7001",
      names: {
        "zh-CN": "旧简中",
        "zh-TW": "Old English",
        "en-US": "Old English",
        "ja-JP": "古い訳",
        "ko-KR": "옛 번역",
      },
      rarity: 4,
      maxInsight: 2,
      defaultVariant: "700101",
      glReleased: false,
      skins: [{ id: "700101", type: "default" }],
    };
    const baseInput: CatalogCompositionInput = {
      arcanists: [makeArcanist(7001, "新简中", "Arc English", [700101])],
      cnCharacters: [{ id: 7001, name: "新简中", nameEng: "CN English", rare: 3 }],
      globalCharacters: [
        { id: 7001, name: "name-key", nameEng: "Global English", rare: 3, isOnline: 0 },
      ],
      cnSkins: [{ id: 700101, characterId: 7001 }],
      globalSkins: [],
      cnEquips: [],
      globalEquips: [],
      languages: {
        ...makeEmptyLanguages(),
        "zh-CN": { "name-key": "新简中" },
        "en-US": { "name-key": " New English " },
      },
      nameFallbacks: new Map(),
      nameOverrides: new Map(),
      policy: makeEmptyPolicy(),
      releaseClock: new Date("2026-01-01T00:00:00.000Z"),
      previousCharacters: [nameHistory],
    };

    const renamed = composeCatalogSource(baseInput).characters[0];
    assert.equal(renamed.names["ja-JP"], "古い訳");
    assert.equal(renamed.names["ko-KR"], "옛 번역");
    // Same-locale LKG is preserved even when identical to previous EN
    assert.equal(renamed.names["zh-TW"], "Old English");
    assert.equal(renamed.names["en-US"], "New English");

    // EN LKG vs fresh current vs absent
    const withoutEnHistory = { ...nameHistory.names };
    delete withoutEnHistory["en-US"];
    for (const [rawEn, globalEn, arcEn, previousEn, expectedEn] of [
      ["", "", "", "Old English", "Old English"],
      ["", "", "   ", "Old English", "Old English"],
      ["   ", " Fresh Current ", "", "Old English", "Fresh Current"],
      ["", "", "", undefined, undefined],
    ] as const) {
      const composed = composeCatalogSource({
        ...baseInput,
        arcanists: baseInput.arcanists.map((entry) => ({ ...entry, nameEng: arcEn })),
        cnCharacters: baseInput.cnCharacters.map((entry) => ({ ...entry, nameEng: "" })),
        globalCharacters: baseInput.globalCharacters.map((entry) => ({ ...entry, nameEng: globalEn })),
        languages: { ...baseInput.languages, "en-US": { "name-key": rawEn } },
        previousCharacters: [
          {
            ...nameHistory,
            names: {
              ...withoutEnHistory,
              ...(previousEn === undefined ? {} : { "en-US": previousEn }),
            },
          },
        ],
      });
      assert.equal(composed.warnings.length, 0);
      assert.equal(composed.characters[0].names["en-US"], expectedEn);
    }

    // Sparse candidate stays sparse rather than borrowing other locales; UTTU fills only missing locale
    const sparse = composeCatalogSource({
      ...baseInput,
      globalCharacters: [],
      uttuCharacterNames: new Map([["7001", { "ja-JP": "後の訳" }]]),
      previousCharacters: [
        { ...nameHistory, names: { "zh-CN": "舊簡中", "en-US": "Old English" } },
      ],
    });
    assert.equal(sparse.warnings.length, 0);
    assert.equal(sparse.characters[0].names["ja-JP"], "後の訳");
    assert.equal("zh-TW" in sparse.characters[0].names, false);
    assert.equal("ko-KR" in sparse.characters[0].names, false);

    // Multi-layer precedence + N/A skipping + lookup-only UTTU for characters & psychubes
    const uttuInput: CatalogCompositionInput = {
      arcanists: [
        makeArcanist(7101, "UTTU 一", "UTTU One", [710101]),
        makeArcanist(7102, "UTTU 二", "UTTU Two", [710201]),
        makeArcanist(7103, "UTTU 三", "UTTU Three", [710301]),
      ],
      cnCharacters: [
        { id: 7101, name: "UTTU 一", nameEng: "UTTU One", rare: 5 },
        { id: 7102, name: "UTTU 二", nameEng: "UTTU Two", rare: 5 },
        { id: 7103, name: "UTTU 三", nameEng: "UTTU Three", rare: 5 },
      ],
      globalCharacters: [
        { id: 7102, name: "same-name-key", nameEng: "Same Name", rare: 5, isOnline: 0 },
      ],
      cnSkins: [710101, 710201, 710301].map((id) => ({
        id,
        characterId: Math.floor(id / 100),
      })),
      globalSkins: [],
      cnEquips: [
        { id: 7201, name: "国服心相", name_en: "CN Psychube", icon: "", rare: 5 },
      ],
      globalEquips: [
        { id: 7202, name: "global-cube", name_en: "Global Psychube", icon: "", rare: 5 },
        { id: 7203, name: "same-name-key", name_en: "Same Name", icon: "", rare: 5 },
        { id: 1000, name: "material", name_en: "Material", icon: "", rare: 5, isExpEquip: 1 },
      ],
      languages: {
        "zh-CN": { "same-name-key": "同名" },
        "zh-TW": { "same-name-key": " Same Name " },
        "en-US": { "same-name-key": "Same Name" },
        "ja-JP": { "same-name-key": "Same Name" },
        "ko-KR": {},
      },
      nameFallbacks: new Map([
        ["7101", { "en-US": "UTTU One", "ja-JP": " UTTU One " }],
      ]),
      nameOverrides: new Map([["7103", { "ko-KR": " UTTU Three " }]]),
      uttuCharacterNames: new Map([
        ["7101", { "zh-TW": "UTTU繁中一", "ja-JP": "UTTU日本語一" }],
        ["7103", { "ja-JP": "UTTU日本語三", "ko-KR": "다른 번역" }],
        ["7999", { "ja-JP": "未收錄角色" }],
      ]),
      uttuPsychubeNames: new Map([
        ["7201", { "zh-TW": "國服心相繁中", "ja-JP": "国服心相日本語" }],
        ["7202", { "zh-TW": "全球心相繁中" }],
        ["1000", { "ja-JP": "素材" }],
      ]),
      previousPsychubes: [
        {
          id: "7201",
          names: {
            "zh-CN": "舊簡中",
            "zh-TW": "舊真譯",
            "en-US": "Old English",
            "ja-JP": "旧日本語",
            "ko-KR": "옛 번역",
          },
          rarity: 5,
          glPresent: false,
        },
        {
          id: "7203",
          names: {
            "zh-CN": "舊簡中",
            "zh-TW": "舊繁中",
            "en-US": "Old English",
          },
          rarity: 5,
          glPresent: true,
        },
      ],
      policy: makeEmptyPolicy(),
      releaseClock: new Date("2026-01-01T00:00:00.000Z"),
    };

    const layer = composeCatalogSource(uttuInput);
    const uttuOne = layer.characters.find((entry) => entry.baseId === "7101")!;
    const uttuSame = layer.characters.find((entry) => entry.baseId === "7102")!;
    const uttuThree = layer.characters.find((entry) => entry.baseId === "7103")!;
    assert.equal(uttuOne.names["ja-JP"], "UTTU One");
    assert.equal(uttuOne.names["zh-TW"], "UTTU繁中一");
    assert.equal(uttuSame.names["zh-TW"], "Same Name");
    assert.equal(uttuSame.names["ja-JP"], "Same Name");
    assert.equal(uttuThree.names["ko-KR"], "UTTU Three");
    assert.equal(uttuThree.names["ja-JP"], "UTTU日本語三");
    assert.equal(layer.characters.some((entry) => entry.baseId === "7999"), false);

    assert.equal(layer.psychubes.find((e) => e.id === "7201")?.names["zh-TW"], "舊真譯");
    assert.equal(layer.psychubes.find((e) => e.id === "7202")?.names["zh-TW"], "全球心相繁中");
    assert.equal(layer.psychubes.find((e) => e.id === "7203")?.names["zh-TW"], "Same Name");
    assert.equal(layer.psychubes.some((e) => e.id === "1000"), false);

    // Higher-priority N/A placeholder must not block valid UTTU translation
    const skippedPlaceholder = composeCatalogSource({
      ...uttuInput,
      languages: {
        ...uttuInput.languages,
        "ja-JP": { "same-name-key": "N/A", "global-cube": "N/A" },
      },
      nameOverrides: new Map([["7102", { "ja-JP": "N/A" }]]),
      nameFallbacks: new Map([["7102", { "ja-JP": "N/A" }]]),
      previousCharacters: layer.characters.map((entry) => ({
        ...entry,
        names: { ...entry.names, "ja-JP": "N/A" },
      })),
      previousPsychubes: layer.psychubes.map((entry) => ({
        ...entry,
        names: { ...entry.names, "ja-JP": "N/A" },
      })),
      uttuCharacterNames: new Map([["7102", { "ja-JP": " 新訳 " }]]),
      uttuPsychubeNames: new Map([["7202", { "ja-JP": " 新訳 " }]]),
    });
    assert.equal(
      skippedPlaceholder.characters.find((e) => e.id === "7102")?.names["ja-JP"],
      "新訳",
    );
    assert.equal(
      skippedPlaceholder.psychubes.find((e) => e.id === "7202")?.names["ja-JP"],
      "新訳",
    );
  });

  it("isolates invalid character candidates by retaining prior complete rows or omitting new invalid ones without resurrecting policy exclusions", () => {
    const priorComplete = validSourceCharacter("9001");
    const absentPrior = validSourceCharacter("9005");
    const excludedPrior = validSourceCharacter("9006");

    const rows: ArcanistEntryFull[] = [
      makeArcanist(9001, "Broken Default", "Broken", [
        makeArcanistSkin(900101),
        makeArcanistSkin(900102),
      ]),
      makeArcanist(9003, "Duplicate", "Duplicate", [
        makeArcanistSkin(900301),
        makeArcanistSkin(900303),
        makeArcanistSkin(900303, { characterSkin: "Dup" }),
      ]),
      makeArcanist(9004, "Unaffected", "Unaffected", [
        makeArcanistSkin(900401),
        makeArcanistSkin(900402),
      ]),
    ];
    const cnCharacters: PackageCharacter[] = rows.map((entry) => ({
      id: Number(entry.id),
      name: entry.name,
      nameEng: entry.nameEng,
      rare: 5,
    }));
    // Omit 900101 from cnSkins so 9001 loses its default Variant
    const cnSkins = rows.flatMap((entry) =>
      entry.live2d
        .filter((variant) => !(entry.id === 9001 && variant.id === 900101))
        .map((variant) => ({
          id: Number(variant.id),
          characterId: Number(entry.id),
        })),
    );

    const result = composeCatalogSource({
      arcanists: rows,
      cnCharacters,
      globalCharacters: [
        {
          id: 9004,
          name: "unaffected-key",
          nameEng: "Fresh Global",
          rare: 6,
          isOnline: 1,
        },
      ],
      cnSkins,
      globalSkins: [],
      cnEquips: [{ id: 9901, name: "equip", name_en: "Equip", icon: "", rare: 5 }],
      globalEquips: [],
      languages: {
        ...makeEmptyLanguages(),
        "zh-CN": { "unaffected-key": "Fresh Global Name" },
        "en-US": { "unaffected-key": "Fresh Global" },
      },
      nameFallbacks: new Map(),
      nameOverrides: new Map(),
      policy: {
        ...makeEmptyPolicy(),
        excludedCharacters: [{ baseId: "9006", reason: "excluded" }],
      },
      releaseClock: new Date("2026-01-01T00:00:00.000Z"),
      previousCharacters: [priorComplete, absentPrior, excludedPrior],
    });

    assert.deepEqual(
      result.characters.find((entry) => entry.baseId === "9001"),
      priorComplete,
    );
    assert.equal(
      result.characters.some((entry) => entry.baseId === "9003"),
      false,
    );
    assert.equal(
      result.characters.find((entry) => entry.baseId === "9004")?.glReleased,
      true,
    );
    assert.deepEqual(
      result.characters.find((entry) => entry.baseId === "9005"),
      absentPrior,
    );
    // Policy exclusion must never be resurrected from previousCharacters
    assert.equal(
      result.characters.some((entry) => entry.baseId === "9006"),
      false,
    );
    assert.deepEqual(
      result.psychubes.map((entry) => entry.id),
      ["9901"],
    );
    assert.ok(
      result.warnings.some(
        (warning) => warning.includes("9001") && warning.includes("retaining"),
      ),
    );
    assert.ok(
      result.warnings.some(
        (warning) => warning.includes("9003") && warning.includes("omitting"),
      ),
    );
  });
});
