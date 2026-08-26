import type { CharacterDef, PsychubeDef } from "../src/types/catalog";
import { emptyProfile, type Profile } from "../src/types/profile";
import {
  characterRefs,
  createProfileMutationEngine,
  psychubeRefs,
  type ProfileMutation,
} from "../src/utils/profile-mutations";
import {
  legalInsights,
  type ProfileMutationCatalog,
} from "../src/utils/catalog";
import { fixtureCharacters, fixturePsychubes } from "./test-fixtures";

function createTestCatalog(
  characters: readonly CharacterDef[],
  psychubes: readonly PsychubeDef[],
  getLegalInsights: ProfileMutationCatalog["legalInsights"] = legalInsights,
): ProfileMutationCatalog {
  return {
    getCharacter: (id) => characters.find((item) => item.id === id),
    getPsychube: (id) => psychubes.find((item) => item.id === id),
    allPsychubes: () => psychubes,
    legalInsights: getLegalInsights,
  };
}

const fixtureCatalog = createTestCatalog(fixtureCharacters, fixturePsychubes);
const mutationEngine = createProfileMutationEngine(fixtureCatalog);
const mutateProfile = mutationEngine.mutateProfile;

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
function apply(
  profile: Profile,
  mutation: ProfileMutation,
  options: Parameters<typeof mutateProfile>[2] = {},
): Profile {
  return mutateProfile(profile, mutation, options).profile;
}
const a = fixtureCharacters[0];
const b = fixtureCharacters[1];
const future = fixtureCharacters[2];
const twins = fixtureCharacters.find((item) => item.id === "3149")!;
const psy = fixturePsychubes[0];
const twinsPsy1 = fixturePsychubes.find((item) => item.id === "1571")!;
const twinsPsy2 = fixturePsychubes.find((item) => item.id === "1572")!;
const futurePsy = fixturePsychubes.find((item) => !item.released)!;
const isolatedCharacter: CharacterDef = {
  ...a,
  id: "fixture-only-character",
  baseId: "fixture-only-character",
  maxInsight: 3,
  defaultVariant: "fixture-only-character-skin",
  skins: [
    {
      ...a.skins[0],
      id: "fixture-only-character-skin",
    },
  ],
};
const isolatedPsychube: PsychubeDef = {
  ...psy,
  id: "fixture-only-psychube",
};
const isolatedEngine = createProfileMutationEngine(
  createTestCatalog([isolatedCharacter], [isolatedPsychube], () => [0]),
);
const emptyInsightEngine = createProfileMutationEngine(
  createTestCatalog([isolatedCharacter], [isolatedPsychube], () => []),
);
const sparseInsightEngine = createProfileMutationEngine(
  createTestCatalog([isolatedCharacter], [isolatedPsychube], () => [3, 1]),
);
const restrictedEngine = createProfileMutationEngine(createTestCatalog([], []));
const baseOptions = {
  allowFutureSight: false,
  addDefaults: { insight: 0 as const, level: 1, portray: 0, resonance: 1 },
  defaultSkinMode: "initial" as const,
  psychubeAmplificationDefault: 1,
};

check(
  "injected catalogs isolate character, psychube, legal insight, and bulk rules",
  (() => {
    let profile = isolatedEngine.mutateProfile(
      emptyProfile(),
      { type: "addCharacter", id: isolatedCharacter.id },
      { addDefaults: { insight: 3, level: 60 } },
    ).profile;
    const characterAdded =
      profile.characters[isolatedCharacter.id]?.insight === 0 &&
      profile.characters[isolatedCharacter.id]?.level === 30;
    const preexisting = emptyProfile();
    preexisting.characters[isolatedCharacter.id] = {
      insight: 3,
      level: 60,
      portray: 0,
      resonance: 1,
      activeVariant: null,
    };
    const sanitized = isolatedEngine.mutateProfile(preexisting, {
      type: "setTeamName",
      team: 0,
      name: "Injected policy",
    }).profile;
    const preexistingSanitized =
      sanitized.characters[isolatedCharacter.id]?.insight === 0 &&
      sanitized.characters[isolatedCharacter.id]?.level === 30;
    const illegalInsight = isolatedEngine.mutateProfile(profile, {
      type: "setInsight",
      id: isolatedCharacter.id,
      value: 1,
    });
    profile = isolatedEngine.mutateProfile(profile, {
      type: "addPsychube",
      id: isolatedPsychube.id,
    }).profile;
    const psychubeAdded = profile.psychubes[isolatedPsychube.id] === 1;
    const bulk = isolatedEngine.mutateProfile(emptyProfile(), {
      type: "setAllPsychubesOwned",
      owned: true,
      amplification: 3,
    }).profile;
    const restricted = restrictedEngine.mutateProfile(emptyProfile(), {
      type: "addCharacter",
      id: isolatedCharacter.id,
    });
    return (
      characterAdded &&
      preexistingSanitized &&
      !illegalInsight.changed &&
      psychubeAdded &&
      bulk.psychubes[isolatedPsychube.id] === 3 &&
      !restricted.changed
    );
  })(),
);

check(
  "an empty injected insight policy rejects additions and drops existing builds",
  (() => {
    const added = emptyInsightEngine.mutateProfile(
      emptyProfile(),
      { type: "addCharacter", id: isolatedCharacter.id },
      { addDefaults: { insight: 3, level: 60 } },
    );
    const preexisting = emptyProfile();
    preexisting.characters[isolatedCharacter.id] = {
      insight: 3,
      level: 60,
      portray: 0,
      resonance: 1,
      activeVariant: null,
    };
    const sanitized = emptyInsightEngine.mutateProfile(preexisting, {
      type: "setTeamName",
      team: 0,
      name: "Empty policy",
    });
    return (
      !added.changed &&
      !added.profile.characters[isolatedCharacter.id] &&
      sanitized.changed &&
      !sanitized.profile.characters[isolatedCharacter.id] &&
      sanitized.profile.teams[0].name === "Empty policy"
    );
  })(),
);

check(
  "a sparse unsorted insight policy normalizes to the nearest legal insight",
  (() => {
    const belowRequested = sparseInsightEngine.mutateProfile(
      emptyProfile(),
      { type: "addCharacter", id: isolatedCharacter.id },
      { addDefaults: { insight: 2, level: 60 } },
    ).profile.characters[isolatedCharacter.id];
    const belowMinimum = sparseInsightEngine.mutateProfile(
      emptyProfile(),
      { type: "addCharacter", id: isolatedCharacter.id },
      { addDefaults: { insight: 0, level: 60 } },
    ).profile.characters[isolatedCharacter.id];
    return (
      belowRequested?.insight === 1 &&
      belowRequested.level === 40 &&
      belowMinimum?.insight === 1 &&
      belowMinimum.level === 40
    );
  })(),
);

check(
  "mutations do not mutate their input",
  (() => {
    const source = emptyProfile();
    const before = JSON.stringify(source);
    mutateProfile(source, { type: "setTeamName", team: 0, name: "Alpha" });
    return JSON.stringify(source) === before;
  })(),
);
check(
  "add character applies defaults and character insight cap",
  (() => {
    const profile = apply(emptyProfile(), { type: "addCharacter", id: b.id }, {
      ...baseOptions,
      addDefaults: { insight: 3, level: 60, portray: 4, resonance: 9 },
    });
    const build = profile.characters[b.id];
    return (
      build.insight === b.maxInsight &&
      build.level === 50 &&
      build.portray === 4 &&
      build.resonance === 9
    );
  })(),
);
check(
  "add defaults preserve configured zero values",
  (() => {
    const profile = apply(emptyProfile(), { type: "addCharacter", id: a.id }, {
      ...baseOptions,
      addDefaults: { insight: 0, level: 1, portray: 0, resonance: 0 },
    });
    return profile.characters[a.id].resonance === 0;
  })(),
);
check(
  "default insight skin only applies on add",
  (() => {
    const profile = apply(emptyProfile(), { type: "addCharacter", id: a.id }, {
      ...baseOptions,
      defaultSkinMode: "insight",
    });
    return profile.characters[a.id].activeVariant === "300302";
  })(),
);
check(
  "insight changes clamp level and reject illegal insight",
  (() => {
    let profile = apply(emptyProfile(), { type: "addCharacter", id: a.id });
    profile = apply(profile, { type: "setInsight", id: a.id, value: 3 });
    profile = apply(profile, { type: "setLevel", id: a.id, value: 60 });
    profile = apply(profile, { type: "setInsight", id: a.id, value: 0 });
    profile = apply(profile, { type: "addCharacter", id: b.id });
    const before = JSON.stringify(profile);
    const rejected = mutateProfile(profile, {
      type: "setInsight",
      id: b.id,
      value: 3,
    });
    return (
      profile.characters[a.id].level === 30 &&
      !rejected.changed &&
      JSON.stringify(rejected.profile) === before
    );
  })(),
);
check(
  "level, resonance, and portray use their domain caps",
  (() => {
    let profile = apply(emptyProfile(), { type: "addCharacter", id: a.id });
    profile = apply(profile, { type: "setLevel", id: a.id, value: 99 });
    profile = apply(profile, { type: "setResonance", id: a.id, value: 99 });
    profile = apply(profile, { type: "setPortray", id: a.id, value: 99 });
    const build = profile.characters[a.id];
    return build.level === 30 && build.resonance === 15 && build.portray === 5;
  })(),
);
check(
  "future character and skin require explicit Future Sight",
  (() => {
    let profile = emptyProfile();
    profile = apply(profile, { type: "addCharacter", id: future.id });
    const blocked = !profile.characters[future.id];
    profile = apply(profile, { type: "addCharacter", id: future.id }, {
      ...baseOptions,
      allowFutureSight: true,
    });
    const skin = future.skins[0];
    profile = apply(profile, {
      type: "setActiveVariant",
      id: future.id,
      value: skin.id,
    });
    return blocked && profile.characters[future.id].activeVariant === skin.id;
  })(),
);
check(
  "skin selection rejects stale ids and hidden unreleased skins",
  (() => {
    let profile = apply(emptyProfile(), { type: "addCharacter", id: a.id });
    profile = apply(profile, {
      type: "setActiveVariant",
      id: a.id,
      value: "missing",
    });
    const staleRejected = profile.characters[a.id].activeVariant === null;
    const futureSkin = a.skins.find((skin) => !skin.released)!;
    profile = apply(profile, {
      type: "setActiveVariant",
      id: a.id,
      value: futureSkin.id,
    });
    return staleRejected && profile.characters[a.id].activeVariant === null;
  })(),
);
check(
  "psychube add, amplification, and removal are pure mutations",
  (() => {
    let profile = apply(emptyProfile(), { type: "addPsychube", id: psy.id }, {
      ...baseOptions,
      psychubeAmplificationDefault: 4,
    });
    profile = apply(profile, {
      type: "setPsychubeAmplification",
      id: psy.id,
      value: 99,
    });
    const capped = profile.psychubes[psy.id] === 5;
    profile = apply(profile, { type: "removePsychube", id: psy.id });
    return capped && !profile.psychubes[psy.id];
  })(),
);
check(
  "future psychubes obey visibility while hidden ownership is preserved",
  (() => {
    let profile = apply(emptyProfile(), { type: "addPsychube", id: futurePsy.id });
    const blocked = !profile.psychubes[futurePsy.id];
    profile = apply(profile, { type: "addPsychube", id: futurePsy.id }, {
      ...baseOptions,
      allowFutureSight: true,
    });
    const owned = profile.psychubes[futurePsy.id] === 1;
    profile = apply(profile, {
      type: "setAllPsychubesOwned",
      owned: false,
      amplification: 1,
    });
    return blocked && owned && profile.psychubes[futurePsy.id] === 1;
  })(),
);
check(
  "assignment requires owned entries and permits cross-team character reuse",
  (() => {
    let profile = apply(emptyProfile(), { type: "addCharacter", id: a.id });
    const missingPsychube = mutateProfile(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: a.id,
      psychubeId: psy.id,
    }).changed;
    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: a.id,
      psychubeId: null,
    });
    profile = apply(profile, {
      type: "assignSlot",
      team: 1,
      slot: 0,
      characterId: a.id,
      psychubeId: null,
    });
    return (
      !missingPsychube &&
      profile.teams[0].slots[0].characterId === a.id &&
      profile.teams[1].slots[0].characterId === a.id
    );
  })(),
);
check(
  "assignment rejects duplicate character and extra regular psychube",
  (() => {
    let profile = emptyProfile();
    profile = apply(profile, { type: "addCharacter", id: a.id });
    profile = apply(profile, { type: "addCharacter", id: b.id });
    profile = apply(profile, { type: "addPsychube", id: psy.id });
    const first = mutateProfile(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: a.id,
      psychubeId: psy.id,
    });
    profile = first.profile;
    const duplicate = mutateProfile(profile, {
      type: "assignSlot",
      team: 0,
      slot: 1,
      characterId: a.id,
      psychubeId: null,
    });
    const extra = mutateProfile(profile, {
      type: "assignSlot",
      team: 0,
      slot: 1,
      characterId: b.id,
      psychubeId: psy.id,
      psychubeId2: psy.id,
    });
    return (
      first.changed &&
      !duplicate.changed &&
      extra.changed &&
      extra.profile.teams[0].slots[1].psychubeId2 === null
    );
  })(),
);
check(
  "dual-psychube assignment auto-owns and equips the pair",
  (() => {
    let profile = apply(emptyProfile(), { type: "addCharacter", id: twins.id }, {
      ...baseOptions,
      psychubeAmplificationDefault: 4,
    });
    profile = apply(profile, { type: "addPsychube", id: twinsPsy1.id });
    const result = mutateProfile(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: twins.id,
      psychubeId: twinsPsy1.id,
    }, {
      ...baseOptions,
      psychubeAmplificationDefault: 4,
    });
    const slot = result.profile.teams[0].slots[0];
    return (
      result.changed &&
      result.profile.psychubes[twinsPsy2.id] === 4 &&
      slot.psychubeId === twinsPsy1.id &&
      slot.psychubeId2 === twinsPsy2.id
    );
  })(),
);
check(
  "character removal clears whole slots and psychube removal clears references",
  (() => {
    let profile = emptyProfile();
    profile = apply(profile, { type: "addCharacter", id: a.id });
    profile = apply(profile, { type: "addPsychube", id: psy.id });
    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: a.id,
      psychubeId: psy.id,
    });
    profile = apply(profile, { type: "removePsychube", id: psy.id });
    const psychubeCleared = profile.teams[0].slots[0].psychubeId === null;
    profile = apply(profile, { type: "removeCharacter", id: a.id });
    const slot = profile.teams[0].slots[0];
    return psychubeCleared && slot.characterId === null && slot.psychubeId2 === null;
  })(),
);
check(
  "team names, swapping, clearing, and bulk ownership preserve team rules",
  (() => {
    let profile = emptyProfile();
    profile = apply(profile, { type: "addCharacter", id: a.id });
    profile = apply(profile, { type: "addCharacter", id: b.id });
    profile = apply(profile, { type: "setTeamName", team: 0, name: "ABCDEFGHIJKLMNO" });
    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: a.id,
      psychubeId: null,
    });
    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 1,
      characterId: b.id,
      psychubeId: null,
    });
    profile = apply(profile, { type: "swapSlots", team: 0, a: 0, b: 1 });
    profile = apply(profile, { type: "clearTeam", team: 0 });
    return (
      profile.teams[0].name === "ABCDEFGHIJKL" &&
      profile.teams[0].slots.every((slot) => slot.characterId === null)
    );
  })(),
);
check(
  "bulk ownership clears visible references but retains hidden references",
  (() => {
    let profile = emptyProfile();
    profile = apply(profile, { type: "addCharacter", id: a.id });
    profile = apply(profile, { type: "addPsychube", id: psy.id });
    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: a.id,
      psychubeId: psy.id,
    });
    profile = apply(profile, { type: "setAllPsychubesOwned", owned: false, amplification: 1 });
    return profile.teams[0].slots[0].psychubeId === null;
  })(),
);
check(
  "character and psychube reference helpers stay outside the store",
  (() => {
    let profile = emptyProfile();
    profile = apply(profile, { type: "addCharacter", id: a.id });
    profile = apply(profile, { type: "addPsychube", id: psy.id });
    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: a.id,
      psychubeId: psy.id,
    });
    return (
      characterRefs(profile, a.id).length === 1 &&
      psychubeRefs(profile, psy.id).length === 1
    );
  })(),
);

console.log(`\nprofile mutation tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
