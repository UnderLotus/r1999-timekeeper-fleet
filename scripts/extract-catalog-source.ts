import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_SOURCE_FILE,
  type CatalogSourceSnapshot,
  type SourceCharacter,
  type SourcePsychube,
  type SourceSkin,
} from "./catalog-source";
import { buildSkins, type ArcanistEntryFull } from "./skin-utils";
import { assertKnownCatalogPolicy, loadCatalogPolicy } from "./catalog-policy";
import { resolveGlobalIsOnline } from "./release-status";
import {
  loadLocalizedNameOverrides,
  loadNameFallbacks,
  type NameLang,
} from "./name-fallbacks";
import { loadCnJSON } from "./sync-cn-data";
import { loadGlJSON, loadGlLanguage } from "./sync-gl-data";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LANGS = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const;
type Lang = (typeof LANGS)[number];
const POLICY_FILE = path.join(__dirname, "data/catalog-policy.json");
const NAME_FALLBACK_FILE = path.join(__dirname, "data/name-fallbacks.json");
const NAME_OVERRIDES_FILE = path.join(
  __dirname,
  "data/localized-name-overrides.json",
);
interface PackageCharacter {
  id: number;
  name: string;
  nameEng?: string;
  rare?: number;
  isOnline?: number | string;
}
interface PackageSkin {
  id: number;
}
interface Equip {
  id: number;
  name: string;
  name_en: string;
  icon: string;
  rare?: number;
  isExpEquip?: number;
  isSpRefine?: number;
}
export function completeCatalogNames(
  zh: string,
  en: string,
  localized: Partial<Record<NameLang, string>>,
): Record<NameLang, string> {
  const fallback = en || zh;
  return {
    "zh-CN": zh,
    "zh-TW": localized["zh-TW"] || fallback,
    "en-US": fallback,
    "ja-JP": localized["ja-JP"] || fallback,
    "ko-KR": localized["ko-KR"] || fallback,
  };
}
function isPsychube(entry: Equip, excluded: ReadonlySet<string>): boolean {
  return (
    !excluded.has(String(entry.id)) &&
    Number(entry.isExpEquip ?? 0) === 0 &&
    Number(entry.isSpRefine ?? 0) === 0 &&
    entry.name_en !== "Just Test"
  );
}
function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function extractCatalogSource(): void {
  console.log("build:source — extract compact CN/GL snapshot\n");
  const arcanists = loadCnJSON<ArcanistEntryFull[]>("ArcanistMap.json");
  const cnCharacters = loadCnJSON<PackageCharacter[]>("character.json");
  const glCharacters = loadGlJSON<PackageCharacter[]>("character.json");
  const cnSkinIds = new Set(
    loadCnJSON<PackageSkin[]>("skin.json").map((entry) => String(entry.id)),
  );
  const glSkins = loadGlJSON<PackageSkin[]>("skin.json");
  const glSkinIds = new Set(glSkins.map((entry) => String(entry.id)));
  if (glSkinIds.size !== glSkins.length)
    throw new Error("Global skin.json contains duplicate IDs");
  const policy = loadCatalogPolicy(POLICY_FILE);
  const rawCnEquips = loadCnJSON<Equip[]>("equip.json");
  assertKnownCatalogPolicy(
    policy,
    new Set(arcanists.map((entry) => String(entry.id))),
    new Set(rawCnEquips.map((entry) => String(entry.id))),
  );
  const excludedCharacters = new Set(
    policy.excludedCharacters.map((entry) => entry.baseId),
  );
  const excludedPsychubes = new Set(
    policy.excludedPsychubes.map((entry) => entry.id),
  );
  const cnCharacterIds = new Set(cnCharacters.map((entry) => entry.id));
  const glByBase = new Map(glCharacters.map((entry) => [entry.id, entry]));
  const knownCharacterIds = new Set(arcanists.map((entry) => String(entry.id)));
  const nameFallbacks = loadNameFallbacks(
    NAME_FALLBACK_FILE,
    knownCharacterIds,
  );
  const nameOverrides = loadLocalizedNameOverrides(
    NAME_OVERRIDES_FILE,
    knownCharacterIds,
  );
  const cnCharacterById = new Map(
    cnCharacters.map((entry) => [entry.id, entry]),
  );
  const langs = Object.fromEntries(
    LANGS.map((lang) => [lang, loadGlLanguage(lang)]),
  ) as Record<Lang, Record<string, string>>;
  const characters: SourceCharacter[] = arcanists
    .filter(
      (arc) =>
        cnCharacterIds.has(arc.id) &&
        !(arc.name ?? "").includes("???") &&
        !excludedCharacters.has(String(arc.id)),
    )
    .map((arc) => {
      const gl = glByBase.get(arc.id);
      const cn = cnCharacterById.get(arc.id);
      const baseId = String(arc.id);
      const fallback = nameFallbacks.get(baseId) ?? {};
      const manualNames = nameOverrides.get(baseId) ?? {};
      const globalName = (lang: NameLang): string =>
        gl ? (langs[lang][gl.name] ?? "") : "";
      const zh =
        globalName("zh-CN") ||
        manualNames["zh-CN"] ||
        fallback["zh-CN"] ||
        arc.name;
      const en =
        globalName("en-US") ||
        gl?.nameEng ||
        manualNames["en-US"] ||
        fallback["en-US"] ||
        arc.nameEng ||
        zh;
      const localized = (lang: NameLang): string =>
        globalName(lang) || manualNames[lang] || fallback[lang] || "";
      const rarity = gl?.rare ?? cn?.rare ?? null;
      return {
        id: baseId,
        baseId,
        names: completeCatalogNames(zh, en, {
          "zh-TW": localized("zh-TW"),
          "ja-JP": localized("ja-JP"),
          "ko-KR": localized("ko-KR"),
        }),
        rarity,
        maxInsight: rarity !== null && rarity >= 4 ? 3 : 2,
        defaultVariant: baseId + "01",
        glReleased: gl ? resolveGlobalIsOnline(gl.isOnline) : false,
        skins: buildSkins(arc)
          .filter((skin) => cnSkinIds.has(skin.id))
          .map(
            ({ released: _released, ...skin }): SourceSkin =>
              skin.type === "skin"
                ? { ...skin, type: "skin", glPresent: glSkinIds.has(skin.id) }
                : { ...skin, type: skin.type },
          ),
      };
    });
  const cnEquips = rawCnEquips.filter((entry) =>
    isPsychube(entry, excludedPsychubes),
  );
  const glEquips = loadGlJSON<Equip[]>("equip.json").filter((entry) =>
    isPsychube(entry, excludedPsychubes),
  );
  const glById = new Map(glEquips.map((entry) => [entry.id, entry]));
  const psychubes: SourcePsychube[] = cnEquips.map((cn) => {
    const gl = glById.get(cn.id);
    const source = gl ?? cn;
    const zh = langs["zh-CN"][source.name] || cn.name || source.name_en;
    const en = langs["en-US"][source.name] || source.name_en || zh;
    const translated = (lang: Lang): string => langs[lang][source.name] || "";
    return {
      id: String(cn.id),
      names: completeCatalogNames(zh, en, {
        "zh-TW": translated("zh-TW"),
        "ja-JP": translated("ja-JP"),
        "ko-KR": translated("ko-KR"),
      }),
      rarity: source.rare ?? null,
      glPresent: glById.has(cn.id),
    };
  });
  const files = [
    "cn/ArcanistMap.json",
    "cn/character.json",
    "cn/equip.json",
    "cn/skin.json",
    "name-fallbacks.json",
    "localized-name-overrides.json",
    "catalog-policy.json",
    "gl/character.json",
    "gl/equip.json",
    "gl/skin.json",
    "gl/language_zh.json",
    "gl/language_tw.json",
    "gl/language_jp.json",
    "gl/language_kr.json",
    "gl/language_en.json",
  ];
  const sourceHashes = Object.fromEntries(
    files.map((file) => [file, sha256(path.join(__dirname, "data", file))]),
  );
  const snapshot: CatalogSourceSnapshot = {
    schemaVersion: 3,
    sourceHashes,
    characters,
    psychubes,
  };
  writeFileSync(CATALOG_SOURCE_FILE, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    `characters: ${characters.length}; skins: ${characters.flatMap((entry) => entry.skins).length}; psychubes: ${psychubes.length}`,
  );
}
if (import.meta.url === "file://" + process.argv[1]) extractCatalogSource();
