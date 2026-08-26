import type { SourceCharacter, SourcePsychube, SourceSkin } from "./catalog-source";
import type { CatalogPolicy } from "./catalog-policy";
import {
  GLOBAL_SERVER_UTC_OFFSET_MINUTES,
  resolveGlobalIsOnline,
  type GlobalClock,
} from "./release-status";
import type { NameLang, PartialNames } from "./name-fallbacks";
import { buildSkins, type ArcanistEntryFull } from "./skin-utils";

export interface PackageCharacter {
  id: number;
  name: string;
  nameEng?: string;
  rare?: number;
  isOnline?: number | string;
}

export interface PackageSkin {
  id: number;
}

export interface Equip {
  id: number;
  name: string;
  name_en: string;
  icon: string;
  rare?: number;
  isExpEquip?: number;
  isSpRefine?: number;
}

export type CatalogLanguageTables = Readonly<
  Record<NameLang, Readonly<Record<string, string>>>
>;

export interface CatalogCompositionInput {
  arcanists: readonly ArcanistEntryFull[];
  cnCharacters: readonly PackageCharacter[];
  globalCharacters: readonly PackageCharacter[];
  cnSkins: readonly PackageSkin[];
  globalSkins: readonly PackageSkin[];
  cnEquips: readonly Equip[];
  globalEquips: readonly Equip[];
  languages: CatalogLanguageTables;
  nameFallbacks: ReadonlyMap<string, PartialNames>;
  nameOverrides: ReadonlyMap<string, PartialNames>;
  policy: CatalogPolicy;
  releaseClock: GlobalClock;
  globalUtcOffsetMinutes?: number;
}

export interface CatalogCompositionResult {
  characters: SourceCharacter[];
  psychubes: SourcePsychube[];
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

/**
 * Deterministically compose the compact catalog from already-normalized
 * snapshots. This module owns cross-source policy; its caller owns all I/O,
 * source validation, hashing, rollback and writes.
 */
export function composeCatalogSource(
  input: CatalogCompositionInput,
): CatalogCompositionResult {
  const cnSkinIds = new Set(input.cnSkins.map((entry) => String(entry.id)));
  const globalSkinIds = new Set(
    input.globalSkins.map((entry) => String(entry.id)),
  );
  const excludedCharacters = new Set(
    input.policy.excludedCharacters.map((entry) => entry.baseId),
  );
  const excludedPsychubes = new Set(
    input.policy.excludedPsychubes.map((entry) => entry.id),
  );
  const cnCharacterIds = new Set(input.cnCharacters.map((entry) => entry.id));
  const globalByBase = new Map(
    input.globalCharacters.map((entry) => [entry.id, entry]),
  );
  const cnById = new Map(input.cnCharacters.map((entry) => [entry.id, entry]));
  const offset =
    input.globalUtcOffsetMinutes ?? GLOBAL_SERVER_UTC_OFFSET_MINUTES;
  const characters: SourceCharacter[] = input.arcanists
    .filter(
      (arc) =>
        cnCharacterIds.has(arc.id) &&
        !(arc.name ?? "").includes("???") &&
        !excludedCharacters.has(String(arc.id)),
    )
    .map((arc) => {
      const global = globalByBase.get(arc.id);
      const cn = cnById.get(arc.id);
      const baseId = String(arc.id);
      const fallback = input.nameFallbacks.get(baseId) ?? {};
      const manualNames = input.nameOverrides.get(baseId) ?? {};
      const globalName = (lang: NameLang): string =>
        global ? input.languages[lang][global.name] ?? "" : "";
      const zh =
        globalName("zh-CN") ||
        manualNames["zh-CN"] ||
        fallback["zh-CN"] ||
        arc.name;
      const en =
        globalName("en-US") ||
        global?.nameEng ||
        manualNames["en-US"] ||
        fallback["en-US"] ||
        arc.nameEng ||
        zh;
      const localized = (lang: NameLang): string =>
        globalName(lang) || manualNames[lang] || fallback[lang] || "";
      const rarity = global?.rare ?? cn?.rare ?? null;
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
        glReleased: global
          ? resolveGlobalIsOnline(
              global.isOnline,
              input.releaseClock,
              offset,
            )
          : false,
        skins: buildSkins(arc)
          .filter((skin) => cnSkinIds.has(skin.id))
          .map(
            ({ released: _released, ...skin }): SourceSkin =>
              skin.type === "skin"
                ? { ...skin, type: "skin", glPresent: globalSkinIds.has(skin.id) }
                : { ...skin, type: skin.type },
          ),
      };
    });
  const cnPsychubes = input.cnEquips.filter((entry) =>
    isPsychube(entry, excludedPsychubes),
  );
  const globalPsychubes = input.globalEquips.filter((entry) =>
    isPsychube(entry, excludedPsychubes),
  );
  const globalById = new Map(globalPsychubes.map((entry) => [entry.id, entry]));
  const psychubes: SourcePsychube[] = cnPsychubes.map((cn) => {
    const global = globalById.get(cn.id);
    const source = global ?? cn;
    const zh = input.languages["zh-CN"][source.name] || cn.name || source.name_en;
    const en = input.languages["en-US"][source.name] || source.name_en || zh;
    const translated = (lang: NameLang): string =>
      input.languages[lang][source.name] || "";
    return {
      id: String(cn.id),
      names: completeCatalogNames(zh, en, {
        "zh-TW": translated("zh-TW"),
        "ja-JP": translated("ja-JP"),
        "ko-KR": translated("ko-KR"),
      }),
      rarity: source.rare ?? null,
      glPresent: globalById.has(cn.id),
    };
  });
  return { characters, psychubes };
}
