import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CharacterDef, PsychubeDef } from "../../src/types/catalog";
import {
  emptyProfile,
  normalizeTeamName,
  type Profile,
} from "../../src/types/profile";
import {
  legalInsights,
  type ProfileMutationCatalog,
} from "../../src/utils/catalog";
import {
  characterRefs,
  createProfileMutationEngine,
  psychubeRefs,
  type ProfileMutation,
  type ProfileMutationOptions,
} from "../../src/utils/profile-mutations";
import { sanitizeProfile } from "../../src/utils/profile-sanitize";
import {
  CHAR_FUTURE,
  CHAR_MISTLETOE,
  CHAR_SONETTO,
  CHAR_TWINS,
  fixtureCharacters,
  fixturePsychubes,
  PSY_ART,
  PSY_FUTURE,
  PSY_NECESSARY,
  PSY_SCIENCE,
} from "../helpers/catalog-fixtures";

function createTestCatalog(
  characters: readonly CharacterDef[] = fixtureCharacters,
  psychubes: readonly PsychubeDef[] = fixturePsychubes,
): ProfileMutationCatalog {
  return {
    getCharacter: (id) => characters.find((item) => item.id === id),
    getPsychube: (id) => psychubes.find((item) => item.id === id),
    allPsychubes: () => psychubes,
    legalInsights,
  };
}

const catalog = createTestCatalog();
const engine = createProfileMutationEngine(catalog);
const mutateProfile = engine.mutateProfile;

const baseOptions: ProfileMutationOptions = {
  allowFutureSight: false,
  addDefaults: { insight: 0, level: 1, portray: 0, resonance: 1 },
  defaultSkinMode: "initial",
  psychubeAmplificationDefault: 1,
};

function apply(
  profile: Profile,
  mutation: ProfileMutation,
  options: ProfileMutationOptions = {},
): Profile {
  return mutateProfile(profile, mutation, options).profile;
}

describe("sanitizeProfile", () => {
  it("normalizes corrupt input into a valid 4x4 Profile", () => {
    const raw = {
      characters: {
        [CHAR_MISTLETOE.id]: {
          insight: 99,
          level: 999,
          portray: -3,
          resonance: Number.NaN,
          activeVariant: "nonexistent",
        },
        [CHAR_SONETTO.id]: {
          insight: 3, // exceeds Sonetto maxInsight=2
          level: 60,
          portray: 99,
          resonance: 99,
          activeVariant: CHAR_SONETTO.defaultVariant,
        },
        unknownChar: { insight: 1, level: 10, portray: 0, resonance: 1 },
      },
      psychubes: {
        [PSY_NECESSARY.id]: 9,
        [PSY_FUTURE.id]: 0, // 0 = unowned, dropped
        unknownPsy: 3,
      },
      teams: [
        {
          name: "  ABCDEFGHIJKLMNO  ",
          slots: [
            {
              characterId: CHAR_MISTLETOE.id,
              psychubeId: PSY_NECESSARY.id,
              psychubeId2: PSY_NECESSARY.id, // stripped for 1-slot character
            },
            {
              // duplicate character in same team -> cleared
              characterId: CHAR_MISTLETOE.id,
              psychubeId: PSY_NECESSARY.id,
              psychubeId2: null,
            },
            {
              // unowned character -> cleared along with psychube
              characterId: CHAR_TWINS.id,
              psychubeId: PSY_NECESSARY.id,
              psychubeId2: null,
            },
            {
              // unowned psychube -> only psychube cleared
              characterId: CHAR_SONETTO.id,
              psychubeId: PSY_FUTURE.id,
              psychubeId2: null,
            },
          ],
        },
      ],
    };

    const sanitized = sanitizeProfile(raw, catalog);
    assert.deepEqual(sanitized.characters[CHAR_MISTLETOE.id], {
      insight: 3,
      level: 60,
      portray: 0,
      resonance: 1,
      activeVariant: null,
    });
    assert.deepEqual(sanitized.characters[CHAR_SONETTO.id], {
      insight: 2,
      level: 50,
      portray: 5,
      resonance: 15,
      activeVariant: CHAR_SONETTO.defaultVariant,
    });
    assert.equal(sanitized.characters.unknownChar, undefined);
    assert.deepEqual(sanitized.psychubes, { [PSY_NECESSARY.id]: 5 });
    assert.equal(sanitized.teams.length, 4);
    assert.equal(sanitized.teams[0].name, "ABCDEFGHIJKL");
    assert.deepEqual(sanitized.teams[0].slots, [
      {
        characterId: CHAR_MISTLETOE.id,
        psychubeId: PSY_NECESSARY.id,
        psychubeId2: null,
      },
      { characterId: null, psychubeId: null, psychubeId2: null },
      { characterId: null, psychubeId: null, psychubeId2: null },
      { characterId: CHAR_SONETTO.id, psychubeId: null, psychubeId2: null },
    ]);
  });

  it("handles non-object input and truncates team names by Unicode code points", () => {
    assert.deepEqual(sanitizeProfile(null, catalog), emptyProfile());
    assert.deepEqual(sanitizeProfile([], catalog), emptyProfile());
    assert.equal(
      normalizeTeamName(`  ${"🌟".repeat(15)}  `),
      "🌟".repeat(12),
    );
  });
});

describe("profile mutations", () => {
  it("never mutates the input Profile", () => {
    const source = emptyProfile();
    const before = structuredClone(source);
    mutateProfile(source, { type: "setTeamName", team: 0, name: "Alpha" });
    assert.deepEqual(source, before);
  });

  it("adds characters with defaults, character insight caps, zero values, and default insight skin", () => {
    const capped = apply(
      emptyProfile(),
      { type: "addCharacter", id: CHAR_SONETTO.id },
      {
        ...baseOptions,
        addDefaults: { insight: 3, level: 60, portray: 4, resonance: 9 },
      },
    );
    assert.deepEqual(capped.characters[CHAR_SONETTO.id], {
      insight: CHAR_SONETTO.maxInsight,
      level: 50,
      portray: 4,
      resonance: 9,
      activeVariant: null,
    });

    const zeroResonance = apply(
      emptyProfile(),
      { type: "addCharacter", id: CHAR_MISTLETOE.id },
      {
        ...baseOptions,
        addDefaults: { insight: 0, level: 1, portray: 0, resonance: 0 },
      },
    );
    assert.equal(zeroResonance.characters[CHAR_MISTLETOE.id].resonance, 0);

    const withInsightSkin = apply(
      emptyProfile(),
      { type: "addCharacter", id: CHAR_MISTLETOE.id },
      { ...baseOptions, defaultSkinMode: "insight" },
    );
    assert.equal(
      withInsightSkin.characters[CHAR_MISTLETOE.id].activeVariant,
      "300302",
    );
  });

  it("clamps cultivation values and rejects illegal insights", () => {
    let profile = apply(emptyProfile(), {
      type: "addCharacter",
      id: CHAR_MISTLETOE.id,
    });
    profile = apply(profile, {
      type: "setInsight",
      id: CHAR_MISTLETOE.id,
      value: 3,
    });
    profile = apply(profile, {
      type: "setLevel",
      id: CHAR_MISTLETOE.id,
      value: 60,
    });
    profile = apply(profile, {
      type: "setInsight",
      id: CHAR_MISTLETOE.id,
      value: 0,
    });
    assert.equal(profile.characters[CHAR_MISTLETOE.id].level, 30);

    profile = apply(profile, {
      type: "setLevel",
      id: CHAR_MISTLETOE.id,
      value: 99,
    });
    profile = apply(profile, {
      type: "setResonance",
      id: CHAR_MISTLETOE.id,
      value: 99,
    });
    profile = apply(profile, {
      type: "setPortray",
      id: CHAR_MISTLETOE.id,
      value: 99,
    });
    assert.deepEqual(profile.characters[CHAR_MISTLETOE.id], {
      insight: 0,
      level: 30,
      resonance: 15,
      portray: 5,
      activeVariant: null,
    });

    profile = apply(profile, { type: "addCharacter", id: CHAR_SONETTO.id });
    const rejected = mutateProfile(profile, {
      type: "setInsight",
      id: CHAR_SONETTO.id,
      value: 3,
    });
    assert.equal(rejected.changed, false);
    assert.deepEqual(rejected.profile, profile);
  });

  it("gates future characters and skins behind Future Sight and rejects stale variant IDs", () => {
    const blocked = mutateProfile(emptyProfile(), {
      type: "addCharacter",
      id: CHAR_FUTURE.id,
    });
    assert.equal(blocked.changed, false);

    let profile = apply(
      emptyProfile(),
      { type: "addCharacter", id: CHAR_FUTURE.id },
      { ...baseOptions, allowFutureSight: true },
    );
    profile = apply(profile, {
      type: "setActiveVariant",
      id: CHAR_FUTURE.id,
      value: CHAR_FUTURE.skins[0].id,
    });
    assert.equal(
      profile.characters[CHAR_FUTURE.id].activeVariant,
      CHAR_FUTURE.skins[0].id,
    );

    profile = apply(profile, { type: "addCharacter", id: CHAR_MISTLETOE.id });
    const futureSkin = CHAR_MISTLETOE.skins.find((skin) => !skin.released)!;
    assert.equal(
      mutateProfile(profile, {
        type: "setActiveVariant",
        id: CHAR_MISTLETOE.id,
        value: "missing",
      }).changed,
      false,
    );
    assert.equal(
      mutateProfile(profile, {
        type: "setActiveVariant",
        id: CHAR_MISTLETOE.id,
        value: futureSkin.id,
      }).changed,
      false,
    );
    const revealedSkin = mutateProfile(
      profile,
      {
        type: "setActiveVariant",
        id: CHAR_MISTLETOE.id,
        value: futureSkin.id,
      },
      { ...baseOptions, allowFutureSight: true },
    );
    assert.equal(revealedSkin.changed, true);
    assert.equal(
      revealedSkin.profile.characters[CHAR_MISTLETOE.id].activeVariant,
      futureSkin.id,
    );
  });

  it("manages psychube ownership, amplification bounds, and zero-amplification removal", () => {
    let profile = apply(
      emptyProfile(),
      { type: "addCharacter", id: CHAR_MISTLETOE.id },
      baseOptions,
    );
    profile = apply(
      profile,
      { type: "addPsychube", id: PSY_NECESSARY.id },
      { ...baseOptions, psychubeAmplificationDefault: 4 },
    );
    assert.equal(profile.psychubes[PSY_NECESSARY.id], 4);

    profile = apply(profile, {
      type: "setPsychubeAmplification",
      id: PSY_NECESSARY.id,
      value: 99,
    });
    assert.equal(profile.psychubes[PSY_NECESSARY.id], 5);

    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: CHAR_MISTLETOE.id,
      psychubeId: PSY_NECESSARY.id,
    });
    profile = apply(profile, {
      type: "setPsychubeAmplification",
      id: PSY_NECESSARY.id,
      value: 0,
    });
    assert.equal(profile.psychubes[PSY_NECESSARY.id], undefined);
    assert.equal(profile.teams[0].slots[0].psychubeId, null);
  });

  it("enforces team slot ownership, cross-team reuse, duplicate rejection, and single-slot psychube cap", () => {
    let profile = emptyProfile();
    profile = apply(profile, { type: "addCharacter", id: CHAR_MISTLETOE.id });
    profile = apply(profile, { type: "addCharacter", id: CHAR_SONETTO.id });

    // Unowned psychube is rejected
    assert.equal(
      mutateProfile(profile, {
        type: "assignSlot",
        team: 0,
        slot: 0,
        characterId: CHAR_MISTLETOE.id,
        psychubeId: PSY_NECESSARY.id,
      }).changed,
      false,
    );

    profile = apply(profile, { type: "addPsychube", id: PSY_NECESSARY.id });
    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: CHAR_MISTLETOE.id,
      psychubeId: PSY_NECESSARY.id,
    });
    // Cross-team reuse of both character and psychube is allowed
    profile = apply(profile, {
      type: "assignSlot",
      team: 1,
      slot: 0,
      characterId: CHAR_MISTLETOE.id,
      psychubeId: PSY_NECESSARY.id,
    });
    assert.equal(profile.teams[0].slots[0].characterId, CHAR_MISTLETOE.id);
    assert.equal(profile.teams[1].slots[0].characterId, CHAR_MISTLETOE.id);

    // Same-team duplicate character is rejected
    assert.equal(
      mutateProfile(profile, {
        type: "assignSlot",
        team: 0,
        slot: 1,
        characterId: CHAR_MISTLETOE.id,
        psychubeId: null,
      }).changed,
      false,
    );

    // Regular character silently strips psychubeId2
    const extra = mutateProfile(profile, {
      type: "assignSlot",
      team: 0,
      slot: 1,
      characterId: CHAR_SONETTO.id,
      psychubeId: PSY_NECESSARY.id,
      psychubeId2: PSY_NECESSARY.id,
    });
    assert.equal(extra.changed, true);
    assert.equal(extra.profile.teams[0].slots[1].psychubeId2, null);

    // Clearing slot character also clears equipped psychubes
    const cleared = apply(extra.profile, {
      type: "assignSlot",
      team: 0,
      slot: 1,
      characterId: null,
      psychubeId: PSY_NECESSARY.id,
    });
    assert.deepEqual(cleared.teams[0].slots[1], {
      characterId: null,
      psychubeId: null,
      psychubeId2: null,
    });
  });

  it("auto-owns and equips the paired psychube for The Twins without overwriting existing amplification", () => {
    let profile = apply(emptyProfile(), {
      type: "addCharacter",
      id: CHAR_TWINS.id,
    });
    profile = apply(profile, { type: "addPsychube", id: PSY_ART.id });

    const autoOwned = mutateProfile(
      profile,
      {
        type: "assignSlot",
        team: 0,
        slot: 0,
        characterId: CHAR_TWINS.id,
        psychubeId: PSY_ART.id,
      },
      { ...baseOptions, psychubeAmplificationDefault: 4 },
    );
    assert.equal(autoOwned.changed, true);
    assert.equal(autoOwned.profile.psychubes[PSY_SCIENCE.id], 4);
    assert.equal(autoOwned.profile.teams[0].slots[0].psychubeId, PSY_ART.id);
    assert.equal(
      autoOwned.profile.teams[0].slots[0].psychubeId2,
      PSY_SCIENCE.id,
    );

    // Re-equipping when PSY_SCIENCE is already owned keeps its existing amplification
    const preserved = mutateProfile(
      autoOwned.profile,
      {
        type: "assignSlot",
        team: 1,
        slot: 0,
        characterId: CHAR_TWINS.id,
        psychubeId: PSY_ART.id,
      },
      { ...baseOptions, psychubeAmplificationDefault: 1 },
    );
    assert.equal(preserved.profile.psychubes[PSY_SCIENCE.id], 4);
  });

  it("swaps slots, truncates team names, clears teams, and cascades removals", () => {
    let profile = emptyProfile();
    profile = apply(profile, { type: "addCharacter", id: CHAR_MISTLETOE.id });
    profile = apply(profile, { type: "addCharacter", id: CHAR_SONETTO.id });
    profile = apply(profile, { type: "addPsychube", id: PSY_NECESSARY.id });
    profile = apply(profile, {
      type: "setTeamName",
      team: 0,
      name: "ABCDEFGHIJKLMNO",
    });
    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: CHAR_MISTLETOE.id,
      psychubeId: PSY_NECESSARY.id,
    });
    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 1,
      characterId: CHAR_SONETTO.id,
      psychubeId: null,
    });

    assert.equal(profile.teams[0].name, "ABCDEFGHIJKL");

    // Verify swapSlots actually exchanges both slots
    profile = apply(profile, { type: "swapSlots", team: 0, a: 0, b: 1 });
    assert.deepEqual(profile.teams[0].slots[0], {
      characterId: CHAR_SONETTO.id,
      psychubeId: null,
      psychubeId2: null,
    });
    assert.deepEqual(profile.teams[0].slots[1], {
      characterId: CHAR_MISTLETOE.id,
      psychubeId: PSY_NECESSARY.id,
      psychubeId2: null,
    });
    assert.equal(
      mutateProfile(profile, { type: "swapSlots", team: 0, a: 1, b: 1 }).changed,
      false,
    );

    // Psychube removal clears only psychube reference; character removal clears whole slot
    profile = apply(profile, { type: "removePsychube", id: PSY_NECESSARY.id });
    assert.equal(profile.teams[0].slots[1].characterId, CHAR_MISTLETOE.id);
    assert.equal(profile.teams[0].slots[1].psychubeId, null);

    profile = apply(profile, { type: "removeCharacter", id: CHAR_MISTLETOE.id });
    assert.deepEqual(profile.teams[0].slots[1], {
      characterId: null,
      psychubeId: null,
      psychubeId2: null,
    });

    profile = apply(profile, { type: "clearTeam", team: 0 });
    assert.equal(profile.teams[0].name, "ABCDEFGHIJKL");
    assert.ok(profile.teams[0].slots.every((slot) => slot.characterId === null));
  });

  it("bulk psychube ownership respects Future Sight and preserves hidden future ownership & slot references", () => {
    const blockedFuture = mutateProfile(emptyProfile(), {
      type: "addPsychube",
      id: PSY_FUTURE.id,
    });
    assert.equal(blockedFuture.changed, false);

    let profile = apply(emptyProfile(), {
      type: "addCharacter",
      id: CHAR_MISTLETOE.id,
    });
    profile = apply(profile, { type: "addCharacter", id: CHAR_SONETTO.id });
    profile = apply(profile, { type: "addPsychube", id: PSY_NECESSARY.id });
    profile = apply(
      profile,
      { type: "addPsychube", id: PSY_FUTURE.id },
      { ...baseOptions, allowFutureSight: true, psychubeAmplificationDefault: 3 },
    );
    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: CHAR_MISTLETOE.id,
      psychubeId: PSY_NECESSARY.id,
    });
    profile = apply(
      profile,
      {
        type: "assignSlot",
        team: 0,
        slot: 1,
        characterId: CHAR_SONETTO.id,
        psychubeId: PSY_FUTURE.id,
      },
      { ...baseOptions, allowFutureSight: true },
    );

    // Clear all visible psychubes with Future Sight OFF
    profile = apply(
      profile,
      { type: "setAllPsychubesOwned", owned: false, amplification: 1 },
      { ...baseOptions, allowFutureSight: false },
    );
    assert.equal(profile.psychubes[PSY_NECESSARY.id], undefined);
    assert.equal(profile.teams[0].slots[0].psychubeId, null);
    // Hidden future psychube ownership and slot reference must both survive
    assert.equal(profile.psychubes[PSY_FUTURE.id], 3);
    assert.equal(profile.teams[0].slots[1].psychubeId, PSY_FUTURE.id);

    // Mark all visible psychubes owned with Future Sight OFF: does not touch hidden future psychube
    profile = apply(
      profile,
      { type: "setAllPsychubesOwned", owned: true, amplification: 2 },
      { ...baseOptions, allowFutureSight: false },
    );
    assert.equal(profile.psychubes[PSY_NECESSARY.id], 2);
    assert.equal(profile.psychubes[PSY_FUTURE.id], 3);
  });

  it("reports character and psychube slot references including dual psychubes", () => {
    let profile = emptyProfile();
    profile = apply(profile, { type: "addCharacter", id: CHAR_MISTLETOE.id });
    profile = apply(profile, { type: "addCharacter", id: CHAR_TWINS.id });
    profile = apply(profile, { type: "addPsychube", id: PSY_NECESSARY.id });
    profile = apply(profile, { type: "addPsychube", id: PSY_ART.id });
    profile = apply(profile, {
      type: "assignSlot",
      team: 1,
      slot: 2,
      characterId: CHAR_MISTLETOE.id,
      psychubeId: PSY_NECESSARY.id,
    });
    profile = apply(profile, {
      type: "assignSlot",
      team: 0,
      slot: 0,
      characterId: CHAR_TWINS.id,
      psychubeId: PSY_ART.id,
    });

    assert.deepEqual(characterRefs(profile, CHAR_MISTLETOE.id), [
      { team: 1, slot: 2 },
    ]);
    assert.deepEqual(psychubeRefs(profile, PSY_NECESSARY.id), [
      { team: 1, slot: 2 },
    ]);
    assert.deepEqual(psychubeRefs(profile, PSY_SCIENCE.id), [
      { team: 0, slot: 0 },
    ]);
  });
});
