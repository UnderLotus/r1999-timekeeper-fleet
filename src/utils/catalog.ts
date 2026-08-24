import type { Profile } from "../types/profile";
import type {
  CharacterDef,
  InsightIndex,
  LangCode,
  PsychubeDef,
  SkinVariant,
} from "../types/catalog";
import { characters } from "../data/characters";
import { psychubes } from "../data/psychubes";
import { LEVEL_CAPS } from "../types/profile";

let charSource: readonly CharacterDef[] = characters;
let psySource: readonly PsychubeDef[] = psychubes;

export function setCatalogForTesting(
  c: readonly CharacterDef[],
  p: readonly PsychubeDef[],
): void {
  charSource = c;
  psySource = p;
}
export function getCharacter(id: string): CharacterDef | undefined {
  return charSource.find((c) => c.id === id);
}
export function getPsychube(id: string): PsychubeDef | undefined {
  return psySource.find((p) => p.id === id);
}
export function allCharacters(): readonly CharacterDef[] {
  return charSource;
}
export function allPsychubes(): readonly PsychubeDef[] {
  return psySource;
}
export function legalInsights(def: CharacterDef): InsightIndex[] {
  return [0, 1, 2, 3].slice(0, def.maxInsight + 1) as InsightIndex[];
}
export function levelCap(_def: CharacterDef, insight: InsightIndex): number {
  return LEVEL_CAPS[insight];
}

export function resolveVariant(
  def: CharacterDef,
  activeVariant: string | null,
): SkinVariant {
  const selected = activeVariant
    ? def.skins.find((skin) => skin.id === activeVariant)
    : undefined;
  if (selected) return selected;
  return (
    def.skins.find((skin) => skin.id === def.defaultVariant) ??
    def.skins.find((skin) => skin.type === "default") ??
    def.skins.find((skin) => skin.type === "insight") ??
    def.skins[0]
  );
}

export function resolveEffectiveVariant(
  def: CharacterDef,
  activeVariant: string | null,
  revealFuture: boolean,
): SkinVariant {
  const stored = resolveVariant(def, activeVariant);
  if (revealFuture || stored.released !== false) return stored;
  return (
    def.skins.find(
      (skin) => skin.id === def.defaultVariant && skin.released !== false,
    ) ??
    def.skins.find(
      (skin) => skin.type === "default" && skin.released !== false,
    ) ??
    def.skins.find(
      (skin) => skin.type === "insight" && skin.released !== false,
    ) ??
    def.skins.find((skin) => skin.released !== false) ??
    stored
  );
}

const LANG_MAP: Record<string, LangCode> = {
  zh: "zh-TW",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
  en: "en-US",
  "en-US": "en-US",
  ja: "ja-JP",
  "ja-JP": "ja-JP",
  ko: "ko-KR",
  "ko-KR": "ko-KR",
};
function resolveLang(lang: string): LangCode | undefined {
  return LANG_MAP[lang];
}
function localizedName(
  names: Partial<Record<LangCode, string>>,
  lang: string,
  fallback: string,
): string {
  const requested = resolveLang(lang);
  return (
    (requested ? names[requested] : undefined) ??
    names["en-US"] ??
    names["zh-CN"] ??
    fallback
  );
}
export function characterName(def: CharacterDef, lang: string): string {
  return localizedName(def.names, lang, def.id);
}
export function psychubeName(def: PsychubeDef, lang: string): string {
  return localizedName(def.names, lang, def.id);
}
export function searchableNames(names: Record<LangCode, string>): string {
  return Object.values(names).join("\n").toLocaleLowerCase();
}

export function profileHasFutureContent(profile: Profile): boolean {
  for (const [id, build] of Object.entries(profile.characters)) {
    const def = getCharacter(id);
    if (!def) continue;
    if (!def.released) return true;
    if (
      build.activeVariant &&
      def.skins.find((skin) => skin.id === build.activeVariant)?.released ===
        false
    )
      return true;
  }
  for (const id of Object.keys(profile.psychubes)) {
    const def = getPsychube(id);
    if (def && !def.released) return true;
  }
  return false;
}
