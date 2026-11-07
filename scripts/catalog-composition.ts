import {
  isCompleteSourceCharacter,
  type SourceCharacter,
  type SourcePsychube,
  type SourceSkin,
} from "./catalog-source";
import type { CatalogPolicy } from "./catalog-policy";
import {
  GLOBAL_SERVER_UTC_OFFSET_MINUTES,
  resolveGlobalIsOnline,
  type GlobalClock,
} from "./release-status";
import type { NameLang, PartialNames } from "./name-fallbacks";
import {
  isTrustedPsychubeName,
  mergePsychubeSourceRecords,
  type PsychubeSourceCandidate,
} from "./psychube-catalog";
import { buildSkins, type ArcanistEntryFull } from "./skin-utils";

export interface PackageCharacter {
  id: number;
  name: string;
  nameEng?: string;
  rare?: number;
  isOnline?: number | string;
}

/** Global skin package rows intentionally carry only their Variant ID. */
export interface PackageSkin {
  id: number;
}

/** CN skin package rows carry the authoritative numeric parent ID. */
export interface CnPackageSkin extends PackageSkin {
  characterId: number;
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
  cnSkins: readonly CnPackageSkin[];
  globalSkins: readonly PackageSkin[];
  cnEquips: readonly Equip[];
  globalEquips: readonly Equip[];
  languages: CatalogLanguageTables;
  nameFallbacks: ReadonlyMap<string, PartialNames>;
  nameOverrides: ReadonlyMap<string, PartialNames>;
  /** Admitted supplemental names: the lowest locale fallback layer. */
  supplementNames?: ReadonlyMap<string, PartialNames>;
  /** Exact-ID locale names from the UTTU snapshot; lookup only, never entities. */
  uttuCharacterNames?: ReadonlyMap<string, PartialNames>;
  uttuPsychubeNames?: ReadonlyMap<string, PartialNames>;
  policy: CatalogPolicy;
  releaseClock: GlobalClock;
  globalUtcOffsetMinutes?: number;
  previousCharacters?: readonly SourceCharacter[];
  previousPsychubes?: readonly SourcePsychube[];
}

export interface CatalogCompositionResult {
  characters: SourceCharacter[];
  psychubes: SourcePsychube[];
  warnings: string[];
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

export function isPsychube(entry: Equip, excluded: ReadonlySet<string>): boolean {
  return (
    !excluded.has(String(entry.id)) &&
    Number(entry.isExpEquip ?? 0) === 0 &&
    Number(entry.isSpRefine ?? 0) === 0 &&
    entry.name_en !== "Just Test"
  );
}

function localeName(value: string | undefined): string | undefined {
  return isTrustedPsychubeName(value) ? value.trim() : undefined;
}

/** A value that only repeats its own row's English or CN is not a translation. */
function repeatsRowLanguage(
  value: string | undefined,
  row: PartialNames | undefined,
): boolean {
  return (
    !value ||
    value === row?.["en-US"]?.trim() ||
    value === row?.["zh-CN"]?.trim()
  );
}

class CharacterCandidateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CharacterCandidateError";
  }
}

function validateCharacterCandidateInput(
  arc: ArcanistEntryFull,
  baseId: string,
): void {
  if (
    !/^\d+$/.test(baseId) ||
    typeof arc.name !== "string" ||
    typeof arc.nameEng !== "string" ||
    !Array.isArray(arc.live2d)
  )
    throw new CharacterCandidateError(
      `Character ${baseId} has an invalid ArcanistMap row`,
    );
  for (const [index, variant] of arc.live2d.entries()) {
    if (
      typeof variant !== "object" ||
      variant === null ||
      !/^\d+$/.test(String(variant.id))
    )
      throw new CharacterCandidateError(
        `Character ${baseId} has an invalid Variant row at index ${index}`,
      );
  }
}

function validateCharacterVariantIntegrity(
  baseId: string,
  skins: readonly SourceSkin[],
  defaultVariant: string,
): void {
  const defaults = skins.filter((skin) => skin.type === "default");
  if (defaults.length !== 1) {
    throw new CharacterCandidateError(
      `Character ${baseId} must emit exactly one default Variant; found ${defaults.length}`,
    );
  }
  if (defaults[0].id !== defaultVariant || !skins.some((skin) => skin.id === defaultVariant)) {
    throw new CharacterCandidateError(
      `Character ${baseId} defaultVariant ${defaultVariant} does not point to its emitted default Variant`,
    );
  }
}

function buildCharacterCandidate(
  input: CatalogCompositionInput,
  arc: ArcanistEntryFull,
  cnSkinIds: ReadonlySet<string>,
  globalSkinIds: ReadonlySet<string>,
  globalByBase: ReadonlyMap<string, PackageCharacter>,
  cnById: ReadonlyMap<string, PackageCharacter>,
  offset: number,
  previous: SourceCharacter | undefined,
): SourceCharacter {
  const baseId = String(arc.id);
  validateCharacterCandidateInput(arc, baseId);
  const global = globalByBase.get(baseId);
  const cn = cnById.get(baseId);
  const fallback = input.nameFallbacks.get(baseId) ?? {};
  const manualNames = input.nameOverrides.get(baseId) ?? {};
  const supplemental = input.supplementNames?.get(baseId);
  const uttuNames = input.uttuCharacterNames?.get(baseId);
  const globalName = (lang: NameLang): string =>
    global ? input.languages[lang][global.name] ?? "" : "";
  const zh =
    globalName("zh-CN") ||
    manualNames["zh-CN"] ||
    fallback["zh-CN"] ||
    (supplemental ? cn?.name : "") ||
    supplemental?.["zh-CN"] ||
    arc.name;
  const en =
    globalName("en-US") ||
    global?.nameEng ||
    manualNames["en-US"] ||
    fallback["en-US"] ||
    (supplemental ? cn?.nameEng : "") ||
    supplemental?.["en-US"] ||
    arc.nameEng ||
    zh;
  const localized = (lang: NameLang): string => {
    const globalLocale = localeName(globalName(lang));
    if (globalLocale) return globalLocale;
    const manual = localeName(manualNames[lang]);
    if (manual) return manual;
    const thirdParty = localeName(fallback[lang]);
    if (thirdParty && !repeatsRowLanguage(thirdParty, fallback))
      return thirdParty;
    const historical = localeName(previous?.names[lang]);
    if (historical && !repeatsRowLanguage(historical, previous?.names))
      return historical;
    return (
      localeName(uttuNames?.[lang]) ??
      localeName(supplemental?.[lang]) ??
      thirdParty ?? historical ?? ""
    );
  };
  const rarity = global?.rare ?? cn?.rare ?? null;
  const emittedSkins: SourceSkin[] = buildSkins(arc)
    .filter((skin) => cnSkinIds.has(skin.id))
    .map(({ released: _released, name, nameEn, ...skin }): SourceSkin => {
      const namedSkin = {
        ...skin,
        ...(name === undefined ? {} : { name }),
        ...(nameEn === undefined ? {} : { nameEn }),
      };
      return skin.type === "skin"
        ? { ...namedSkin, type: "skin", glPresent: globalSkinIds.has(skin.id) }
        : { ...namedSkin, type: skin.type };
    });
  const defaultVariant = emittedSkins.find((skin) => skin.type === "default")?.id ?? "";
  validateCharacterVariantIntegrity(baseId, emittedSkins, defaultVariant);
  let glReleased = false;
  if (global) {
    try {
      glReleased = resolveGlobalIsOnline(
        global.isOnline,
        input.releaseClock,
        offset,
      );
    } catch (error) {
      throw new CharacterCandidateError(
        `Character ${baseId} has invalid Global release data`,
        { cause: error },
      );
    }
  }
  const candidate: SourceCharacter = {
    id: baseId,
    baseId,
    names: completeCatalogNames(zh, en, {
      "zh-TW": localized("zh-TW"),
      "ja-JP": localized("ja-JP"),
      "ko-KR": localized("ko-KR"),
    }),
    rarity,
    maxInsight: rarity !== null && rarity >= 4 ? 3 : 2,
    defaultVariant,
    glReleased,
    skins: emittedSkins,
  };
  if (!isCompleteSourceCharacter(candidate)) {
    throw new CharacterCandidateError(
      `Character ${baseId} completed SourceCharacter row is invalid`,
    );
  }
  return candidate;
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
  const cnCharacterIds = new Set(input.cnCharacters.map((entry) => String(entry.id)));
  const globalByBase = new Map(
    input.globalCharacters.map((entry) => [String(entry.id), entry]),
  );
  const cnById = new Map(input.cnCharacters.map((entry) => [String(entry.id), entry]));
  const offset =
    input.globalUtcOffsetMinutes ?? GLOBAL_SERVER_UTC_OFFSET_MINUTES;
  const previousByBase = new Map(
    (input.previousCharacters ?? []).map((entry) => [entry.baseId, entry]),
  );
  const charactersByBase = new Map<string, SourceCharacter>();
  const warnings: string[] = [];

  for (const arc of input.arcanists) {
    const baseId = String(arc.id);
    if (
      !cnCharacterIds.has(baseId) ||
      (arc.name ?? "").includes("???") ||
      excludedCharacters.has(baseId)
    )
      continue;
    try {
      charactersByBase.set(
        baseId,
        buildCharacterCandidate(
          input,
          arc,
          cnSkinIds,
          globalSkinIds,
          globalByBase,
          cnById,
          offset,
          previousByBase.get(baseId),
        ),
      );
    } catch (error) {
      if (!(error instanceof CharacterCandidateError)) throw error;
      const previous = previousByBase.get(baseId);
      if (previous) {
        charactersByBase.set(baseId, previous);
        warnings.push(
          `Character ${baseId} candidate invalid; retaining the previous complete SourceCharacter row: ${error.message}`,
        );
      } else {
        warnings.push(
          `Character ${baseId} candidate invalid; omitting this new character: ${error.message}`,
        );
      }
    }
  }

  // A transient upstream snapshot may omit an existing character. Keep its
  // whole prior generation, except for explicit catalog-policy exclusions.
  for (const previous of input.previousCharacters ?? []) {
    if (excludedCharacters.has(previous.baseId)) continue;
    if (!charactersByBase.has(previous.baseId))
      charactersByBase.set(previous.baseId, previous);
  }
  const characters = [...charactersByBase.values()];

  const cnPsychubes = input.cnEquips.filter((entry) =>
    isPsychube(entry, excludedPsychubes),
  );
  const globalPsychubes = input.globalEquips.filter((entry) =>
    isPsychube(entry, excludedPsychubes),
  );
  const cnPsychubeById = new Map(cnPsychubes.map((entry) => [entry.id, entry]));
  const globalPsychubeById = new Map(globalPsychubes.map((entry) => [entry.id, entry]));
  const psychubeIds = new Set([
    ...cnPsychubeById.keys(),
    ...globalPsychubeById.keys(),
  ]);
  const previousPsychubeById = new Map(
    (input.previousPsychubes ?? []).map((entry) => [entry.id, entry]),
  );
  // Locale precedence needs the raw missing-value information, so each record
  // keeps only explicitly resolved names until the retention merge completes it.
  const psychubeCandidates: PsychubeSourceCandidate[] = [...psychubeIds].map(
    (id) => {
      const cn = cnPsychubeById.get(id);
      const global = globalPsychubeById.get(id);
      const source = global ?? cn!;
      const previous = previousPsychubeById.get(String(id));
      const uttuNames = input.uttuPsychubeNames?.get(String(id));
      const zh = input.languages["zh-CN"][source.name] || cn?.name || "";
      const en =
        input.languages["en-US"][source.name] ||
        source.name_en ||
        cn?.name_en ||
        "";
      const names: PartialNames = {};
      if (zh) names["zh-CN"] = zh;
      if (en) names["en-US"] = en;
      for (const lang of ["zh-TW", "ja-JP", "ko-KR"] as const) {
        const globalLocale = localeName(input.languages[lang][source.name]);
        const historical = localeName(previous?.names[lang]);
        const resolved = globalLocale ||
          (historical && !repeatsRowLanguage(historical, previous?.names)
            ? historical
            : undefined) ||
          localeName(uttuNames?.[lang]) ||
          historical;
        if (resolved) names[lang] = resolved;
      }
      return {
        id: String(id),
        names,
        rarity: source.rare ?? cn?.rare ?? null,
        glPresent: global !== undefined,
      };
    },
  );
  const psychubes = mergePsychubeSourceRecords(
    input.previousPsychubes ?? [],
    psychubeCandidates,
  );
  return { characters, psychubes, warnings };
}
