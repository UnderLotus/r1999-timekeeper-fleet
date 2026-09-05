import type { InsightIndex } from "../types/catalog";
import type { CharacterBuild, DefaultSkinMode, Profile } from "../types/profile";
import {
  emptyProfile,
  LEVEL_CAPS,
  normalizeTeamName,
  PORTRAY_MAX,
  PSYCHUBE_IMPRINT_MAX as PSYCHUBE_AMPLIFICATION_MAX,
  RESONANCE_MAX,
  SLOTS_PER_TEAM,
  TEAM_COUNT,
} from "../types/profile";
import type { ProfileMutationCatalog } from "./catalog";
import {
  ADD_DEFAULT,
  normalizeLegalInsight,
  sanitizeProfile,
} from "./profile-sanitize";

/**
 * Runtime choices that affect a Profile mutation. The active-profile owner
 * supplies these values; the mutation implementation does not know about
 * Zustand, persistence, or Preview state.
 */
export interface ProfileMutationOptions {
  allowFutureSight?: boolean;
  addDefaults?: Partial<Omit<CharacterBuild, "activeVariant">>;
  defaultSkinMode?: DefaultSkinMode;
  psychubeAmplificationDefault?: number;
}

export type ProfileMutation =
  | { type: "addCharacter"; id: string }
  | { type: "removeCharacter"; id: string }
  | { type: "setInsight"; id: string; value: InsightIndex }
  | { type: "setLevel"; id: string; value: number }
  | { type: "setResonance"; id: string; value: number }
  | { type: "setPortray"; id: string; value: number }
  | { type: "setActiveVariant"; id: string; value: string | null }
  | { type: "addPsychube"; id: string }
  | { type: "setPsychubeAmplification"; id: string; value: number }
  | { type: "removePsychube"; id: string }
  | {
      type: "assignSlot";
      team: number;
      slot: number;
      characterId: string | null;
      psychubeId: string | null;
      psychubeId2?: string | null;
    }
  | { type: "setTeamName"; team: number; name: string }
  | { type: "swapSlots"; team: number; a: number; b: number }
  | { type: "clearTeam"; team: number }
  | { type: "reset" }
  | { type: "setAllPsychubesOwned"; owned: boolean; amplification: number };

export interface ProfileMutationResult {
  profile: Profile;
  changed: boolean;
}

export interface ProfileMutationEngine {
  mutateProfile(
    input: Profile,
    mutation: ProfileMutation,
    options?: ProfileMutationOptions,
  ): ProfileMutationResult;
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const clean = Math.trunc(finite(value, fallback));
  return Math.min(max, Math.max(min, clean));
}

function optionsWithDefaults(options: ProfileMutationOptions): {
  allowFutureSight: boolean;
  addDefaults: Omit<CharacterBuild, "activeVariant">;
  defaultSkinMode: DefaultSkinMode;
  psychubeAmplificationDefault: number;
} {
  const requested = options.addDefaults ?? {};
  return {
    allowFutureSight: options.allowFutureSight === true,
    addDefaults: {
      insight: clamp(requested.insight, 0, 3, ADD_DEFAULT.insight) as InsightIndex,
      level: clamp(requested.level, 1, 60, ADD_DEFAULT.level),
      portray: clamp(requested.portray, 0, PORTRAY_MAX, ADD_DEFAULT.portray),
      resonance: clamp(
        requested.resonance,
        0,
        RESONANCE_MAX,
        ADD_DEFAULT.resonance,
      ),
    },
    defaultSkinMode:
      options.defaultSkinMode === "insight" ? "insight" : "initial",
    psychubeAmplificationDefault: clamp(
      options.psychubeAmplificationDefault,
      1,
      PSYCHUBE_AMPLIFICATION_MAX,
      1,
    ),
  };
}

function result(profile: Profile, changed: boolean): ProfileMutationResult {
  return { profile, changed };
}

function replaceProfile(
  next: Profile,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  return result(sanitizeProfile(next, catalog), true);
}

function emptySlot() {
  return { characterId: null, psychubeId: null, psychubeId2: null } as const;
}

function addCharacter(
  profile: Profile,
  id: string,
  options: ReturnType<typeof optionsWithDefaults>,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const def = catalog.getCharacter(id);
  if (
    !def ||
    profile.characters[id] ||
    (!def.released && !options.allowFutureSight)
  )
    return result(profile, false);
  const insight = normalizeLegalInsight(
    def,
    options.addDefaults.insight,
    catalog,
  );
  if (insight === null) return result(profile, false);
  const activeVariant =
    options.defaultSkinMode === "insight"
      ? (def.skins.find(
          (skin) =>
            skin.type === "insight" &&
            (skin.released !== false || options.allowFutureSight),
        )?.id ?? null)
      : null;
  const build: CharacterBuild = {
    ...options.addDefaults,
    insight,
    level: Math.min(options.addDefaults.level, LEVEL_CAPS[insight]),
    activeVariant,
  };
  return replaceProfile(
    {
      ...profile,
      characters: { ...profile.characters, [id]: build },
    },
    catalog,
  );
}

function removeCharacter(
  profile: Profile,
  id: string,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  if (!profile.characters[id]) return result(profile, false);
  const characters = { ...profile.characters };
  delete characters[id];
  const teams = profile.teams.map((team) => ({
    ...team,
    slots: team.slots.map((slot) =>
      slot.characterId === id ? emptySlot() : { ...slot },
    ),
  }));
  return replaceProfile({ ...profile, characters, teams }, catalog);
}

function setInsight(
  profile: Profile,
  id: string,
  value: InsightIndex,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const def = catalog.getCharacter(id),
    build = profile.characters[id];
  if (!def || !build || !catalog.legalInsights(def).includes(value))
    return result(profile, false);
  return replaceProfile(
    {
      ...profile,
      characters: {
        ...profile.characters,
        [id]: {
          ...build,
          insight: value,
          level: Math.min(build.level, LEVEL_CAPS[value]),
        },
      },
    },
    catalog,
  );
}

function setLevel(
  profile: Profile,
  id: string,
  value: number,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const build = profile.characters[id];
  if (!build) return result(profile, false);
  const level = Math.min(
    LEVEL_CAPS[build.insight],
    Math.max(1, Math.trunc(value) || 1),
  );
  return replaceProfile(
    {
      ...profile,
      characters: { ...profile.characters, [id]: { ...build, level } },
    },
    catalog,
  );
}

function setResonance(
  profile: Profile,
  id: string,
  value: number,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const build = profile.characters[id];
  if (!build) return result(profile, false);
  const resonance = Math.min(
    RESONANCE_MAX,
    Math.max(0, Math.trunc(value) || 0),
  );
  return replaceProfile(
    {
      ...profile,
      characters: { ...profile.characters, [id]: { ...build, resonance } },
    },
    catalog,
  );
}

function setPortray(
  profile: Profile,
  id: string,
  value: number,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const build = profile.characters[id];
  if (!build) return result(profile, false);
  const portray = Math.min(
    PORTRAY_MAX,
    Math.max(0, Math.trunc(value) || 0),
  );
  return replaceProfile(
    {
      ...profile,
      characters: { ...profile.characters, [id]: { ...build, portray } },
    },
    catalog,
  );
}

function setActiveVariant(
  profile: Profile,
  id: string,
  value: string | null,
  options: ReturnType<typeof optionsWithDefaults>,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const build = profile.characters[id],
    def = catalog.getCharacter(id),
    selected = value === null ? null : def?.skins.find((skin) => skin.id === value);
  if (
    !build ||
    !def ||
    (value !== null && !selected) ||
    (selected?.released === false && !options.allowFutureSight)
  )
    return result(profile, false);
  return replaceProfile(
    {
      ...profile,
      characters: {
        ...profile.characters,
        [id]: { ...build, activeVariant: value },
      },
    },
    catalog,
  );
}

function addPsychube(
  profile: Profile,
  id: string,
  options: ReturnType<typeof optionsWithDefaults>,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const def = catalog.getPsychube(id);
  if (
    !def ||
    profile.psychubes[id] ||
    (!def.released && !options.allowFutureSight)
  )
    return result(profile, false);
  return replaceProfile(
    {
      ...profile,
      psychubes: {
        ...profile.psychubes,
        [id]: options.psychubeAmplificationDefault,
      },
    },
    catalog,
  );
}

function setPsychubeAmplification(
  profile: Profile,
  id: string,
  value: number,
  options: ReturnType<typeof optionsWithDefaults>,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const def = catalog.getPsychube(id);
  if (
    !def ||
    (!profile.psychubes[id] && !def.released && !options.allowFutureSight)
  )
    return result(profile, false);
  const clean = Math.min(
    PSYCHUBE_AMPLIFICATION_MAX,
    Math.max(0, Math.trunc(value) || 0),
  );
  const psychubes = { ...profile.psychubes };
  if (clean > 0) psychubes[id] = clean;
  else delete psychubes[id];
  return replaceProfile({ ...profile, psychubes }, catalog);
}

function removePsychube(
  profile: Profile,
  id: string,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const wasOwned = !!profile.psychubes[id];
  const psychubes = { ...profile.psychubes };
  delete psychubes[id];
  const teams = profile.teams.map((team) => ({
    ...team,
    slots: team.slots.map((slot) => ({
      ...slot,
      psychubeId: slot.psychubeId === id ? null : slot.psychubeId,
      psychubeId2: slot.psychubeId2 === id ? null : slot.psychubeId2,
    })),
  }));
  const hadReference = profile.teams.some((team) =>
    team.slots.some((slot) => slot.psychubeId === id || slot.psychubeId2 === id),
  );
  if (!wasOwned && !hadReference) return result(profile, false);
  return replaceProfile({ ...profile, psychubes, teams }, catalog);
}

function assignSlot(
  profile: Profile,
  mutation: Extract<ProfileMutation, { type: "assignSlot" }>,
  options: ReturnType<typeof optionsWithDefaults>,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const {
    team: teamIndex,
    slot: slotIndex,
    characterId,
    psychubeId: requestedPrimary,
    psychubeId2: requestedSecondary = null,
  } = mutation;
  if (
    teamIndex < 0 ||
    teamIndex >= TEAM_COUNT ||
    slotIndex < 0 ||
    slotIndex >= SLOTS_PER_TEAM
  )
    return result(profile, false);
  if (characterId !== null && !profile.characters[characterId])
    return result(profile, false);
  const characterDef = characterId
    ? catalog.getCharacter(characterId)
    : undefined;
  if (characterId && !characterDef) return result(profile, false);
  let psychubes = profile.psychubes;
  let psychubeId = requestedPrimary;
  let psychubeId2 = requestedSecondary;
  if (!characterId) {
    psychubeId = null;
    psychubeId2 = null;
  }
  const [pairedPrimary, pairedSecondary] =
    characterDef?.exclusivePsychubeIds ?? [];
  if (
    characterDef?.psychubeSlots === 2 &&
    psychubeId === pairedPrimary &&
    pairedSecondary
  ) {
    const pairedDef = catalog.getPsychube(pairedSecondary);
    if (
      !pairedDef ||
      (!pairedDef.released && !options.allowFutureSight)
    )
      return result(profile, false);
    psychubeId2 = pairedSecondary;
    if (!psychubes[pairedSecondary])
      psychubes = {
        ...psychubes,
        [pairedSecondary]: options.psychubeAmplificationDefault,
      };
  }
  const allowedPsychubeSlots = characterDef?.psychubeSlots ?? 0;
  if (allowedPsychubeSlots < 2) psychubeId2 = null;
  const requestedPsychubes = [psychubeId, psychubeId2].filter(
    (id): id is string => id !== null,
  );
  if (requestedPsychubes.some((id) => !psychubes[id]))
    return result(profile, false);
  const team = profile.teams[teamIndex],
    currentSlot = team.slots[slotIndex];
  if (characterId && characterId !== currentSlot.characterId) {
    if (
      !characterDef ||
      (!characterDef.released && !options.allowFutureSight)
    )
      return result(profile, false);
  }
  for (const id of requestedPsychubes) {
    const def = catalog.getPsychube(id);
    if (!def || (!def.released && !options.allowFutureSight))
      return result(profile, false);
  }
  if (
    characterId &&
    team.slots.some(
      (slot, index) => index !== slotIndex && slot.characterId === characterId,
    )
  )
    return result(profile, false);
  const teams = profile.teams.map((item, index) =>
    index === teamIndex
      ? {
          ...item,
          slots: item.slots.map((slot, index) =>
            index === slotIndex
              ? { characterId, psychubeId, psychubeId2 }
              : { ...slot },
          ),
        }
      : item,
  );
  return replaceProfile({ ...profile, psychubes, teams }, catalog);
}

function setTeamName(
  profile: Profile,
  teamIndex: number,
  name: string,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  if (teamIndex < 0 || teamIndex >= TEAM_COUNT)
    return result(profile, false);
  const teams = profile.teams.map((team, index) =>
    index === teamIndex ? { ...team, name: normalizeTeamName(name) } : team,
  );
  return replaceProfile({ ...profile, teams }, catalog);
}

function swapSlots(
  profile: Profile,
  teamIndex: number,
  a: number,
  b: number,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  if (
    teamIndex < 0 ||
    teamIndex >= TEAM_COUNT ||
    a < 0 ||
    b < 0 ||
    a >= SLOTS_PER_TEAM ||
    b >= SLOTS_PER_TEAM ||
    a === b
  )
    return result(profile, false);
  const teams = profile.teams.map((team, index) => {
    if (index !== teamIndex) return team;
    const slots = team.slots.map((slot) => ({ ...slot }));
    [slots[a], slots[b]] = [slots[b], slots[a]];
    return { ...team, slots };
  });
  return replaceProfile({ ...profile, teams }, catalog);
}

function clearTeam(
  profile: Profile,
  teamIndex: number,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  if (teamIndex < 0 || teamIndex >= TEAM_COUNT)
    return result(profile, false);
  const teams = profile.teams.map((team, index) =>
    index === teamIndex
      ? { ...team, slots: team.slots.map(() => emptySlot()) }
      : team,
  );
  return replaceProfile({ ...profile, teams }, catalog);
}

function setAllPsychubesOwned(
  profile: Profile,
  owned: boolean,
  amplification: number,
  options: ReturnType<typeof optionsWithDefaults>,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const selectable = new Set(
    catalog.allPsychubes()
      .filter(
        (definition) => definition.released || options.allowFutureSight,
      )
      .map((definition) => definition.id),
  );
  const cleanAmplification = Math.min(
    PSYCHUBE_AMPLIFICATION_MAX,
    Math.max(1, Math.trunc(amplification) || 1),
  );
  const psychubes = { ...profile.psychubes };
  for (const id of selectable) {
    if (owned) psychubes[id] = cleanAmplification;
    else delete psychubes[id];
  }
  const teams = owned
    ? profile.teams
    : profile.teams.map((team) => ({
        ...team,
        slots: team.slots.map((slot) => ({
          ...slot,
          psychubeId:
            slot.psychubeId && selectable.has(slot.psychubeId)
              ? null
              : slot.psychubeId,
          psychubeId2:
            slot.psychubeId2 && selectable.has(slot.psychubeId2)
              ? null
              : slot.psychubeId2,
        })),
      }));
  return replaceProfile({ ...profile, psychubes, teams }, catalog);
}

/**
 * Apply one domain operation without mutating the input or requiring a store.
 * The input is sanitized first and every successful result is sanitized again,
 * so runtime edits and persisted/share payloads share one Profile invariant.
 */
function applyProfileMutation(
  input: Profile,
  mutation: ProfileMutation,
  options: ProfileMutationOptions,
  catalog: ProfileMutationCatalog,
): ProfileMutationResult {
  const profile = sanitizeProfile(input, catalog),
    normalized = optionsWithDefaults(options);
  switch (mutation.type) {
    case "addCharacter":
      return addCharacter(profile, mutation.id, normalized, catalog);
    case "removeCharacter":
      return removeCharacter(profile, mutation.id, catalog);
    case "setInsight":
      return setInsight(profile, mutation.id, mutation.value, catalog);
    case "setLevel":
      return setLevel(profile, mutation.id, mutation.value, catalog);
    case "setResonance":
      return setResonance(profile, mutation.id, mutation.value, catalog);
    case "setPortray":
      return setPortray(profile, mutation.id, mutation.value, catalog);
    case "setActiveVariant":
      return setActiveVariant(
        profile,
        mutation.id,
        mutation.value,
        normalized,
        catalog,
      );
    case "addPsychube":
      return addPsychube(profile, mutation.id, normalized, catalog);
    case "setPsychubeAmplification":
      return setPsychubeAmplification(
        profile,
        mutation.id,
        mutation.value,
        normalized,
        catalog,
      );
    case "removePsychube":
      return removePsychube(profile, mutation.id, catalog);
    case "assignSlot":
      return assignSlot(profile, mutation, normalized, catalog);
    case "setTeamName":
      return setTeamName(profile, mutation.team, mutation.name, catalog);
    case "swapSlots":
      return swapSlots(profile, mutation.team, mutation.a, mutation.b, catalog);
    case "clearTeam":
      return clearTeam(profile, mutation.team, catalog);
    case "reset":
      return result(emptyProfile(), true);
    case "setAllPsychubesOwned":
      return setAllPsychubesOwned(
        profile,
        mutation.owned,
        mutation.amplification,
        normalized,
        catalog,
      );
  }
}

export function createProfileMutationEngine(
  catalog: ProfileMutationCatalog,
): ProfileMutationEngine {
  return {
    mutateProfile: (input, mutation, options = {}) =>
      applyProfileMutation(input, mutation, options, catalog),
  };
}

export function characterRefs(
  profile: Profile,
  id: string,
): Array<{ team: number; slot: number }> {
  const refs: Array<{ team: number; slot: number }> = [];
  profile.teams.forEach((team, teamIndex) =>
    team.slots.forEach((slot, slotIndex) => {
      if (slot.characterId === id)
        refs.push({ team: teamIndex, slot: slotIndex });
    }),
  );
  return refs;
}

export function psychubeRefs(
  profile: Profile,
  id: string,
): Array<{ team: number; slot: number }> {
  const refs: Array<{ team: number; slot: number }> = [];
  profile.teams.forEach((team, teamIndex) =>
    team.slots.forEach((slot, slotIndex) => {
      if (slot.psychubeId === id || slot.psychubeId2 === id)
        refs.push({ team: teamIndex, slot: slotIndex });
    }),
  );
  return refs;
}
