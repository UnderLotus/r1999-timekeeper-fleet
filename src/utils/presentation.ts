import type { LangCode } from "../i18n/ui";
import type { CharacterBuild, Profile, TeamSlot } from "../types/profile";
import type { CharacterDef, PsychubeDef, SkinVariant } from "../types/catalog";
import {
  characterName,
  getCharacter,
  getPsychube,
  psychubeName,
  resolveEffectiveVariant,
} from "./catalog";
export interface CharacterPresentation {
  definition: CharacterDef;
  build?: CharacterBuild;
  hidden: boolean;
  name: string;
  variant: SkinVariant;
}
export function presentCharacter(
  definition: CharacterDef,
  build: CharacterBuild | undefined,
  lang: LangCode,
  revealFuture: boolean,
  hiddenLabel: string,
): CharacterPresentation {
  const hidden = !definition.released && !revealFuture;
  return {
    definition,
    build,
    hidden,
    name: hidden ? hiddenLabel : characterName(definition, lang),
    variant: resolveEffectiveVariant(
      definition,
      build?.activeVariant ?? null,
      revealFuture,
    ),
  };
}
export interface PsychubePresentation {
  definition: PsychubeDef;
  hidden: boolean;
  name: string;
}
export function presentPsychube(
  definition: PsychubeDef,
  lang: LangCode,
  revealFuture: boolean,
  hiddenLabel: string,
): PsychubePresentation {
  const hidden = !definition.released && !revealFuture;
  return {
    definition,
    hidden,
    name: hidden ? hiddenLabel : psychubeName(definition, lang),
  };
}
export function presentTeamSlot(
  slot: TeamSlot,
  profile: Profile,
  lang: LangCode,
  revealFuture: boolean,
  hiddenLabel: string,
) {
  const definition = slot.characterId
    ? getCharacter(slot.characterId)
    : undefined;
  const build = slot.characterId
    ? profile.characters[slot.characterId]
    : undefined;
  const character = definition
    ? presentCharacter(definition, build, lang, revealFuture, hiddenLabel)
    : undefined;
  const psychubes = [slot.psychubeId, slot.psychubeId2].map((id) => {
    const psychube = id ? getPsychube(id) : undefined;
    return psychube
      ? presentPsychube(psychube, lang, revealFuture, hiddenLabel)
      : undefined;
  });
  return { character, psychubes };
}
