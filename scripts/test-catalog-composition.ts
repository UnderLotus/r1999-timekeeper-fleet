import {
  composeCatalogSource,
  type CatalogLanguageTables,
  type Equip,
  type PackageCharacter,
} from "./catalog-composition";
import type { CatalogPolicy } from "./catalog-policy";
import type { SourceCharacter } from "./catalog-source";
import { buildSkins, type ArcanistEntryFull } from "./skin-utils";

let pass = 0;
let fail = 0;
function check(name: string, value: boolean): void {
  if (value) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function arcanist(
  id: number,
  name: string,
  nameEng: string,
  variants: number[],
): ArcanistEntryFull {
  return {
    id,
    name,
    nameEng,
    live2d: variants.map((variantId) => ({
      id: variantId,
      name: `CN skin ${variantId}`,
      nameEng: `Skin ${variantId}`,
      des: "",
      characterSkin: `CN skin ${variantId}`,
      characterSkinNameEng: `Skin ${variantId}`,
    })),
  };
}

const arcanists = [
  arcanist(1001, "CN One", "CN One English", [100101, 100102, 100103]),
  arcanist(1002, "CN Two", "CN Two English", [100201]),
  arcanist(9999, "Excluded", "Excluded English", [999901]),
];
const cnCharacters: PackageCharacter[] = [
  { id: 1001, name: "CN One", nameEng: "CN One English", rare: 4 },
  { id: 1002, name: "CN Two", nameEng: "CN Two English", rare: 3 },
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
  { id: 999901, characterId: 9999 },
];
const globalSkins = [{ id: 100103 }];
const cnEquips: Equip[] = [
  { id: 2001, name: "cn-cube", name_en: "CN Cube", icon: "", rare: 5 },
  { id: 2002, name: "excluded-cube", name_en: "Excluded Cube", icon: "", rare: 5 },
  { id: 2003, name: "exp", name_en: "EXP", icon: "", rare: 5, isExpEquip: 1 },
  { id: 2004, name: "refine", name_en: "Refine", icon: "", rare: 5, isSpRefine: 1 },
  { id: 2005, name: "test", name_en: "Just Test", icon: "", rare: 5 },
  { id: 2006, name: "cn-only-cube", name_en: "CN Only Cube", icon: "", rare: 4 },
];
const globalEquips: Equip[] = [
  { id: 2001, name: "global-cube", name_en: "Global Cube", icon: "", rare: 6 },
  { id: 2007, name: "global-only", name_en: "Global Only", icon: "", rare: 5 },
  { id: 2008, name: "untranslated", name_en: "English Only", icon: "", rare: 5 },
];
const languages: CatalogLanguageTables = {
  "zh-CN": { "global-key": "全球一", "global-only": "Global 独立" },
  "zh-TW": {},
  "en-US": { "global-key": "Global One", "global-only": "Global Only" },
  "ja-JP": {},
  "ko-KR": {},
};
const policy: CatalogPolicy = {
  excludedCharacters: [{ baseId: "9999", reason: "fixture exclusion" }],
  excludedPsychubes: [{ id: "2002", reason: "fixture exclusion" }],
  characterCapabilities: [],
  preservedCharacterAssets: [],
  ignoredCnSkinStubs: [],
};
const metadataClassified = buildSkins({
  id: 4100,
  name: "metadata",
  nameEng: "metadata",
  live2d: [
    {
      id: 410001,
      name: "",
      nameEng: "",
      des: "进阶皮肤",
      characterSkin: "",
      characterSkinNameEng: "",
    },
    {
      id: 410002,
      name: "",
      nameEng: "",
      des: "初始皮肤",
      characterSkin: "",
      characterSkinNameEng: "",
    },
    {
      id: 41000001,
      name: "",
      nameEng: "",
      des: "",
      characterSkin: "",
      characterSkinNameEng: "",
    },
  ],
});
check(
  "Variant metadata wins before exact legacy IDs and opaque IDs stay Skins",
  metadataClassified[0].type === "insight" &&
    metadataClassified[1].type === "default" &&
    metadataClassified[2].type === "skin",
);

const result = composeCatalogSource({
  arcanists,
  cnCharacters,
  globalCharacters,
  cnSkins,
  globalSkins,
  cnEquips,
  globalEquips,
  languages,
  nameFallbacks: new Map([
    ["1001", { "en-US": "Fallback One", "ja-JP": "Fallback Japanese" }],
    ["1002", { "en-US": "Fallback Two" }],
  ]),
  nameOverrides: new Map([
    ["1001", { "ja-JP": "Manual Japanese" }],
  ]),
  policy,
  releaseClock: new Date("2026-09-03T10:00:00.000Z"),
  globalUtcOffsetMinutes: -5 * 60,
});
const one = result.characters.find((entry) => entry.baseId === "1001");
const two = result.characters.find((entry) => entry.baseId === "1002");
const oneSkins = new Map(one?.skins.map((skin) => [skin.id, skin]));
const garment = oneSkins.get("100103");
const defaultSkin = oneSkins.get("100101");
const psychubeIds = result.psychubes.map((entry) => entry.id);

check(
  "Global localized names take precedence and manual localized fallback remains available",
  one?.names["zh-CN"] === "全球一" &&
    one?.names["en-US"] === "Global One" &&
    one?.names["ja-JP"] === "Manual Japanese",
);
check(
  "CN fallback supplies a character absent from Global",
  two?.names["zh-CN"] === "CN Two" &&
    two?.names["en-US"] === "Fallback Two" &&
    two?.rarity === 3 &&
    two.glReleased === false,
);
check(
  "release classification consumes the explicit server-local timestamp clock",
  one?.glReleased === true && one?.rarity === 5 && one?.maxInsight === 3,
);
check(
  "garment presence is mapped while default and insight variants stay type-only",
  garment?.type === "skin" &&
    garment.glPresent === true &&
    defaultSkin?.type === "default" &&
    !("glPresent" in (defaultSkin ?? {})),
);
check(
  "psychube metadata composes CN-only, Global-only, and joint IDs independently",
  JSON.stringify(psychubeIds) === JSON.stringify(["2001", "2006", "2007", "2008"]) &&
    result.psychubes.find((entry) => entry.id === "2001")?.glPresent === true &&
    result.psychubes.find((entry) => entry.id === "2006")?.glPresent === false &&
    result.psychubes.find((entry) => entry.id === "2007")?.names["zh-CN"] === "Global 独立" &&
    result.psychubes.find((entry) => entry.id === "2007")?.glPresent === true,
);
check(
  "psychube English data is never substituted into the trusted Simplified Chinese field",
  result.psychubes.find((entry) => entry.id === "2008")?.names["zh-CN"] === "" &&
    result.psychubes.find((entry) => entry.id === "2008")?.names["en-US"] === "English Only",
);
check(
  "manual catalog policy exclusions are applied to characters and psychubes",
  !result.characters.some((entry) => entry.baseId === "9999") &&
    !result.psychubes.some((entry) => entry.id === "2002"),
);

const longIdResult = composeCatalogSource({
  arcanists: [
    {
      id: 3066,
      name: "37",
      nameEng: "Thirty-seven",
      live2d: [
        {
          id: 306601,
          name: "37",
          nameEng: "Thirty-seven",
          des: "",
          characterSkin: "",
          characterSkinNameEng: "",
        },
        {
          id: 30660001,
          name: "37的往日",
          nameEng: "Portrait of the Past",
          des: "",
          characterSkin: "37的往日",
          characterSkinNameEng: "Portrait of the Past",
        },
      ],
    },
    {
      id: 3088,
      name: "塞梅尔维斯",
      nameEng: "Semmelweis",
      live2d: [
        {
          id: 308801,
          name: "塞梅尔维斯",
          nameEng: "Semmelweis",
          des: "",
          characterSkin: "",
          characterSkinNameEng: "",
        },
        {
          id: 30880001,
          name: "塞梅尔维斯的往日",
          nameEng: "Portrait of the Past",
          des: "",
          characterSkin: "塞梅尔维斯的往日",
          characterSkinNameEng: "Portrait of the Past",
        },
      ],
    },
  ],
  cnCharacters: [
    { id: 3066, name: "37", nameEng: "Thirty-seven", rare: 6 },
    { id: 3088, name: "塞梅尔维斯", nameEng: "Semmelweis", rare: 5 },
  ],
  globalCharacters: [],
  cnSkins: [
    { id: 306601, characterId: 3066 },
    { id: 30660001, characterId: 3066 },
    { id: 308801, characterId: 3088 },
    { id: 30880001, characterId: 3088 },
  ],
  globalSkins: [],
  cnEquips: [],
  globalEquips: [],
  languages: {
    "zh-CN": {},
    "zh-TW": {},
    "en-US": {},
    "ja-JP": {},
    "ko-KR": {},
  },
  nameFallbacks: new Map(),
  nameOverrides: new Map(),
  policy: {
    excludedCharacters: [],
    excludedPsychubes: [],
    characterCapabilities: [],
    preservedCharacterAssets: [],
    ignoredCnSkinStubs: [],
  },
  releaseClock: new Date("2026-01-01T00:00:00.000Z"),
});
for (const [baseId, variantId] of [["3066", "30660001"], ["3088", "30880001"]]) {
  const character = longIdResult.characters.find((entry) => entry.baseId === baseId)!;
  const variant = character.skins.find((skin) => skin.id === variantId)!;
  check(
    `complete Variant ID ${variantId} is an owned unreleased Skin for ${baseId}`,
    variant.type === "skin" && variant.glPresent === false &&
      character.defaultVariant === `${baseId}01` &&
      character.skins.filter((skin) => skin.type === "default").length === 1 &&
      character.skins.some((skin) => skin.id === character.defaultVariant),
  );
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
      {
        id: `${baseId}02`,
        type: "insight",
        name: `${marker} insight`,
        nameEn: `${marker} insight`,
      },
      {
        id: `${baseId}03`,
        type: "skin",
        name: `${marker} skin`,
        nameEn: `${marker} skin`,
        glPresent: false,
      },
    ],
  };
}
const retainedPrior = priorCharacter("1001", "previous generation");
const absentPrior = priorCharacter("1004", "transiently absent");
const retentionResult = composeCatalogSource({
  arcanists: [
    arcanist(1001, "Broken One", "Broken One", [100102]),
    arcanist(1002, "Fresh Two", "Fresh Two", [100201, 100202]),
    arcanist(1003, "Broken New", "Broken New", [100302]),
  ],
  cnCharacters: [
    { id: 1001, name: "Broken One", nameEng: "Broken One", rare: 4 },
    { id: 1002, name: "Fresh Two", nameEng: "Fresh Two", rare: 5 },
    { id: 1003, name: "Broken New", nameEng: "Broken New", rare: 5 },
  ],
  globalCharacters: [
    { id: 1001, name: "retained-key", nameEng: "Fresh Broken One", isOnline: 1 },
    { id: 1002, name: "fresh-key", nameEng: "Fresh Global Two", isOnline: 1 },
  ],
  cnSkins: [
    { id: 100102, characterId: 1001 },
    { id: 100201, characterId: 1002 },
    { id: 100202, characterId: 1002 },
    { id: 100302, characterId: 1003 },
  ],
  globalSkins: [],
  cnEquips: [
    { id: 2001, name: "fresh-equip", name_en: "Fresh Psychube", icon: "", rare: 5 },
  ],
  globalEquips: [],
  languages: {
    "zh-CN": { "retained-key": "current broken name", "fresh-key": "fresh global name", "fresh-equip": "新心相" },
    "zh-TW": {},
    "en-US": { "retained-key": "Current Broken", "fresh-key": "Fresh Global", "fresh-equip": "Fresh Psychube" },
    "ja-JP": {},
    "ko-KR": {},
  },
  nameFallbacks: new Map(),
  nameOverrides: new Map(),
  policy: {
    excludedCharacters: [],
    excludedPsychubes: [],
    characterCapabilities: [],
    preservedCharacterAssets: [],
    ignoredCnSkinStubs: [],
  },
  releaseClock: new Date("2026-01-01T00:00:00.000Z"),
  previousCharacters: [retainedPrior, absentPrior],
});
const retained = retentionResult.characters.find((entry) => entry.baseId === "1001");
const fresh = retentionResult.characters.find((entry) => entry.baseId === "1002");
check(
  "invalid existing character retains one complete prior generation without Global field merging",
  JSON.stringify(retained) === JSON.stringify(retainedPrior) &&
    !retentionResult.warnings.some((warning) => warning.includes("current broken name")),
);
check(
  "invalid new character is omitted while a transiently absent prior row remains",
  !retentionResult.characters.some((entry) => entry.baseId === "1003") &&
    retentionResult.characters.some((entry) => entry.baseId === "1004") &&
    retentionResult.warnings.some((warning) => warning.includes("1003") && warning.includes("omitting")),
);
check(
  "unaffected character receives fresh Global i18n and release data and psychubes continue",
  fresh?.names["zh-CN"] === "fresh global name" &&
    fresh?.names["en-US"] === "Fresh Global" &&
    fresh.glReleased === true &&
    retentionResult.psychubes.some((entry) => entry.id === "2001"),
);
console.log(`\ncatalog composition tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);