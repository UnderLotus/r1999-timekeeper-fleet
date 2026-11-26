import type { SourceCharacter, SourceSkin } from "./catalog-source";

export interface CharacterAssetCandidate {
  baseId: string;
  id: string;
  type: SourceSkin["type"];
}

export type MissingCharacterAssetAction =
  | "convert"
  | "retain"
  | "install-supplement"
  | "skip";

/** Discover every Variant asset from the compact catalog source, including skins that are not runtime-effective yet. */
export function collectCharacterAssetCandidates(
  characters: readonly SourceCharacter[],
): CharacterAssetCandidate[] {
  const byId = new Map<string, CharacterAssetCandidate>();
  for (const character of characters) {
    for (const skin of character.skins) {
      const candidate: CharacterAssetCandidate = {
        baseId: character.baseId,
        id: skin.id,
        type: skin.type,
      };
      const previous = byId.get(candidate.id);
      if (
        previous &&
        (previous.baseId !== candidate.baseId || previous.type !== candidate.type)
      ) {
        throw new Error(
          `Character asset candidate ${candidate.id} has conflicting catalog metadata`,
        );
      }
      byId.set(candidate.id, candidate);
    }
  }
  return [...byId.values()];
}

/**
 * Decide how a missing source PNG affects one catalog Variant. A primary PNG is
 * the preferred source, an installed trusted WebP is never replaced by the
 * secondary source, and a validated supplemental headicon only fills the gap
 * the primary source leaves.
 */
export function classifyMissingCharacterAsset(
  hasSourcePng: boolean,
  hasTrustedProductionWebp: boolean,
  hasSupplementalWebp = false,
): MissingCharacterAssetAction {
  if (hasSourcePng) return "convert";
  if (hasTrustedProductionWebp) return "retain";
  if (hasSupplementalWebp) return "install-supplement";
  return "skip";
}

/** Return no runtime row until all of its initial and insight images are installed. */
export function filterRuntimeCharacterSkins(
  skins: readonly SourceSkin[],
  installedAssetIds: ReadonlySet<string>,
): SourceSkin[] | null {
  if (skins.some((skin) => skin.type !== "skin" && !installedAssetIds.has(skin.id)))
    return null;
  return skins.filter((skin) => installedAssetIds.has(skin.id));
}
