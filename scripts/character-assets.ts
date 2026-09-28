import type { SourceCharacter, SourceSkin } from "./catalog-source";

export interface CharacterAssetCandidate {
  baseId: string;
  id: string;
  type: SourceSkin["type"];
}

export type MissingCharacterAssetAction =
  | "convert"
  | "retain"
  | "skip"
  | "fatal";

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

/** Decide how a missing source PNG affects one catalog Variant. */
export function classifyMissingCharacterAsset(
  candidate: Pick<CharacterAssetCandidate, "type">,
  hasSourcePng: boolean,
  hasTrustedProductionWebp: boolean,
): MissingCharacterAssetAction {
  if (hasSourcePng) return "convert";
  if (hasTrustedProductionWebp) return "retain";
  return candidate.type === "skin" ? "skip" : "fatal";
}

/** Keep only Variants with installed assets while refusing to hide a required default or insight asset failure. */
export function filterRuntimeCharacterSkins(
  skins: readonly SourceSkin[],
  installedAssetIds: ReadonlySet<string>,
): SourceSkin[] {
  const missingRequired = skins.filter(
    (skin) => skin.type !== "skin" && !installedAssetIds.has(skin.id),
  );
  if (missingRequired.length) {
    throw new Error(
      `Required character Variant asset missing: ${missingRequired
        .map((skin) => skin.id)
        .join(", ")}`,
    );
  }
  return skins.filter(
    (skin) => skin.type !== "skin" || installedAssetIds.has(skin.id),
  );
}
