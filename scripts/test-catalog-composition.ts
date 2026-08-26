import {
  composeCatalogSource,
  type CatalogLanguageTables,
  type Equip,
  type PackageCharacter,
} from "./catalog-composition";
import type { CatalogPolicy } from "./catalog-policy";
import type { ArcanistEntryFull } from "./skin-utils";

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
  { id: 100101 },
  { id: 100102 },
  { id: 100103 },
  { id: 100201 },
  { id: 999901 },
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
];
const languages: CatalogLanguageTables = {
  "zh-CN": { "global-key": "全球一" },
  "zh-TW": {},
  "en-US": { "global-key": "Global One" },
  "ja-JP": {},
  "ko-KR": {},
};
const policy: CatalogPolicy = {
  excludedCharacters: [{ baseId: "9999", reason: "fixture exclusion" }],
  excludedPsychubes: [{ id: "2002", reason: "fixture exclusion" }],
  characterCapabilities: [],
};
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
  "psychube composition keeps CN entries, marks Global presence, and filters invalid entries",
  JSON.stringify(psychubeIds) === JSON.stringify(["2001", "2006"]) &&
    result.psychubes.find((entry) => entry.id === "2001")?.glPresent === true &&
    result.psychubes.find((entry) => entry.id === "2006")?.glPresent === false,
);
check(
  "manual catalog policy exclusions are applied to characters and psychubes",
  !result.characters.some((entry) => entry.baseId === "9999") &&
    !result.psychubes.some((entry) => entry.id === "2002"),
);

console.log(`\ncatalog composition tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);