import assert from "node:assert/strict";
import {
  composeCatalogSource,
  type CatalogLanguageTables,
  type PackageCharacter,
} from "./catalog-composition";
import type { CatalogPolicy } from "./catalog-policy";
import {
  isCompleteSourceCharacter,
  type SourceCharacter,
} from "./catalog-source";
import type { ArcanistEntryFull, ArcanistSkinFull } from "./skin-utils";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validCharacter(): SourceCharacter {
  return {
    id: "9000",
    baseId: "9000",
    names: {
      "zh-CN": "中文",
      "zh-TW": "繁中",
      "en-US": "English",
      "ja-JP": "日本語",
      "ko-KR": "한국어",
    },
    rarity: 5,
    maxInsight: 3,
    defaultVariant: "900001",
    glReleased: false,
    skins: [
      { id: "900001", type: "default" },
      { id: "900002", type: "insight", name: "", nameEn: "" },
      {
        id: "900003",
        type: "skin",
        name: "Skin",
        nameEn: "Skin",
        glPresent: false,
      },
    ],
  };
}

const valid = validCharacter();
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
    `canonical Chinese is required and optional locale values must be valid: ${JSON.stringify(names)}`,
  );
}
const malformedOptionalName = clone(valid);
(malformedOptionalName.skins[2] as Record<string, unknown>).name = 123;
assert.equal(
  isCompleteSourceCharacter(malformedOptionalName),
  false,
  "present Variant name fields must be strings",
);
const blankOptionalTranslations = clone(valid);
blankOptionalTranslations.skins[1].name = "";
blankOptionalTranslations.skins[1].nameEn = "";
assert.equal(
  isCompleteSourceCharacter(blankOptionalTranslations),
  true,
  "optional Variant translations may be blank",
);
const duplicateVariant = clone(valid);
duplicateVariant.skins.push({ ...duplicateVariant.skins[2] });
assert.equal(
  isCompleteSourceCharacter(duplicateVariant),
  false,
  "Variant IDs must be unique within one character",
);
const defaultGlPresent = clone(valid) as SourceCharacter & {
  skins: Array<Record<string, unknown>>;
};
defaultGlPresent.skins[0].glPresent = false;
assert.equal(
  isCompleteSourceCharacter(defaultGlPresent),
  false,
  "default and insight Variants cannot carry glPresent",
);

function skin(id: number, overrides: Partial<ArcanistSkinFull> = {}): ArcanistSkinFull {
  return {
    id,
    name: "",
    nameEng: "",
    des: "",
    characterSkin: "",
    characterSkinNameEng: "",
    ...overrides,
  };
}

function arcanist(
  id: number,
  name: string,
  nameEng: string,
  variants: ArcanistSkinFull[],
): ArcanistEntryFull {
  return { id, name, nameEng, live2d: variants };
}

function priorCharacter(baseId: string, marker: string): SourceCharacter {
  return {
    id: baseId,
    baseId,
    names: {
      "zh-CN": marker,
      "zh-TW": marker,
      "en-US": marker,
      "ja-JP": marker,
      "ko-KR": marker,
    },
    rarity: 4,
    maxInsight: 2,
    defaultVariant: `${baseId}01`,
    glReleased: false,
    skins: [
      { id: `${baseId}01`, type: "default" },
      { id: `${baseId}02`, type: "insight", name: "", nameEn: "" },
      { id: `${baseId}03`, type: "skin", name: "", nameEn: "", glPresent: false },
    ],
  };
}

const rows: ArcanistEntryFull[] = [
  arcanist(9001, "Fresh Candidate", "Fresh Candidate English", [
    skin(900101),
    skin(900102),
    skin(900103, { characterSkin: "Skin", characterSkinNameEng: "Skin" }),
  ]),
  arcanist(9003, "Duplicate", "Duplicate", [
    skin(900301),
    skin(900302),
    skin(900303),
    skin(900303, { characterSkin: "Duplicate", characterSkinNameEng: "Duplicate" }),
  ]),
  arcanist(9004, "Unaffected", "Unaffected English", [
    skin(900401),
    skin(900402),
    skin(900403, { characterSkin: "Unaffected Skin", characterSkinNameEng: "Unaffected Skin" }),
  ]),
];
const cnCharacters: PackageCharacter[] = rows.map((entry) => ({
  id: Number(entry.id),
  name: entry.name,
  nameEng: entry.nameEng,
  rare: 5,
}));
const cnSkins = rows.flatMap((entry) =>
  entry.live2d
    .filter((variant) => !(entry.id === 9001 && variant.id === 900101))
    .map((variant) => ({
      id: Number(variant.id),
      characterId: Number(entry.id),
    })),
);
const languages: CatalogLanguageTables = {
  "zh-CN": { "unaffected-key": "Fresh Global Name" },
  "zh-TW": {},
  "en-US": { "unaffected-key": "Fresh Global" },
  "ja-JP": {},
  "ko-KR": {},
};
const policy: CatalogPolicy = {
  excludedCharacters: [],
  excludedPsychubes: [],
  characterCapabilities: [],
  preservedCharacterAssets: [],
  ignoredCnSkinStubs: [],
};
const absentPrior = priorCharacter("9005", "Prior absent");
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
  languages,
  nameFallbacks: new Map(),
  nameOverrides: new Map(),
  policy,
  releaseClock: new Date("2026-01-01T00:00:00.000Z"),
  previousCharacters: [priorCharacter("9001", "Prior complete"), absentPrior],
});
assert.deepEqual(
  result.characters.find((entry) => entry.baseId === "9001"),
  priorCharacter("9001", "Prior complete"),
  "missing-default structural candidate retains the complete prior row",
);
assert.equal(
  result.characters.some((entry) => entry.baseId === "9003"),
  false,
  "invalid duplicate-Variant new candidate is omitted",
);
const unaffected = result.characters.find((entry) => entry.baseId === "9004");
assert.equal(unaffected?.names["zh-CN"], "Fresh Global Name");
assert.equal(unaffected?.names["en-US"], "Fresh Global");
assert.equal(unaffected?.glReleased, true);
assert.deepEqual(
  result.psychubes.map((entry) => entry.id),
  ["9901"],
  "unaffected catalog updates continue",
);
assert.deepEqual(
  result.characters.find((entry) => entry.baseId === "9005"),
  absentPrior,
  "a transiently absent prior row is retained",
);
assert.ok(
  result.warnings.some(
    (warning) => warning.includes("9001") && warning.includes("retaining"),
  ),
  "an invalid candidate warns that it retains the previous row",
);
assert.ok(result.warnings.some((warning) => warning.includes("9003") && warning.includes("omitting")));

console.log("catalog source validation regressions: passed");
