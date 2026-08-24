import {
  ADD_DEFAULT,
  migratePersistedState,
  sanitizeProfile,
  useBoxStore,
} from "../src/store/boxStore";
import { emptyProfile } from "../src/types/profile";
import {
  profileHasFutureContent,
  setCatalogForTesting,
} from "../src/utils/catalog";
import { fixtureCharacters, fixturePsychubes } from "./test-fixtures";
setCatalogForTesting(fixtureCharacters, fixturePsychubes);
let pass = 0,
  fail = 0;
function check(name: string, value: boolean): void {
  if (value) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.error("  ✗ " + name);
  }
}
const a = fixtureCharacters[0],
  b = fixtureCharacters[1],
  twins = fixtureCharacters.find((item) => item.id === "3149")!,
  psy = fixturePsychubes[0],
  twinsPsy1 = fixturePsychubes.find((item) => item.id === "1571")!,
  twinsPsy2 = fixturePsychubes.find((item) => item.id === "1572")!;
function fresh() {
  useBoxStore.setState({
    profile: emptyProfile(),
    previewProfile: null,
    activeIsPreview: false,
    previewShowFutureSight: false,
    ui: {
      tab: "characters",
      search: "",
      filterMode: "all",
      rarityFilter: [],
      assignment: null,
    },
    preferences: {
      lang: "zh-TW",
      langChosen: false,
      showFutureSight: false,
      addDefaults: { ...ADD_DEFAULT },
      defaultSkinMode: "initial",
    },
  });
  return useBoxStore.getState();
}
check(
  "empty profile is 4x4",
  (() => {
    const p = fresh().profile;
    return p.teams.length === 4 && p.teams.every((t) => t.slots.length === 4);
  })(),
);
check(
  "add defaults are applied",
  (() => {
    fresh();
    useBoxStore.getState().addCharacter(a.id);
    const v = useBoxStore.getState().profile.characters[a.id];
    return v.insight === 0 && v.level === 1 && v.activeVariant === null;
  })(),
);
check(
  "default insight skin applies only to newly added characters",
  (() => {
    fresh();
    const s = useBoxStore.getState();
    s.setDefaultSkinMode("insight");
    s.addCharacter(a.id);
    return (
      useBoxStore.getState().profile.characters[a.id].activeVariant === "300302"
    );
  })(),
);
check(
  "configurable add defaults clamp to character",
  (() => {
    fresh();
    useBoxStore
      .getState()
      .setAddDefaults({ insight: 3, level: 60, portray: 4, resonance: 9 });
    useBoxStore.getState().addCharacter(b.id);
    const v = useBoxStore.getState().profile.characters[b.id];
    return (
      v.insight === b.maxInsight &&
      v.level === 50 &&
      v.portray === 4 &&
      v.resonance === 9
    );
  })(),
);
check(
  "low rarity rejects I3",
  (() => {
    fresh();
    useBoxStore.getState().addCharacter(b.id);
    useBoxStore.getState().setInsight(b.id, 3);
    return useBoxStore.getState().profile.characters[b.id].insight <= 2;
  })(),
);
check(
  "lower insight clamps level",
  (() => {
    fresh();
    const s = useBoxStore.getState();
    s.addCharacter(a.id);
    s.setInsight(a.id, 3);
    s.setLevel(a.id, 60);
    s.setInsight(a.id, 0);
    return useBoxStore.getState().profile.characters[a.id].level === 30;
  })(),
);
check(
  "duplicate character in one team rejected",
  (() => {
    fresh();
    const s = useBoxStore.getState();
    s.addCharacter(a.id);
    const first = s.assignSlot(0, 0, a.id, null);
    const duplicate = s.assignSlot(0, 1, a.id, null);
    return (
      first === true &&
      duplicate === false &&
      useBoxStore.getState().profile.teams[0].slots[0].characterId === a.id &&
      useBoxStore.getState().profile.teams[0].slots[1].characterId === null
    );
  })(),
);
check(
  "cross-team reuse allowed",
  (() => {
    fresh();
    const s = useBoxStore.getState();
    s.addCharacter(a.id);
    s.assignSlot(0, 0, a.id, null);
    s.assignSlot(1, 0, a.id, null);
    return (
      useBoxStore.getState().profile.teams[1].slots[0].characterId === a.id
    );
  })(),
);
check(
  "psychube requires character",
  (() => {
    fresh();
    const s = useBoxStore.getState();
    s.setPsychubeImprint(psy.id, 1);
    s.assignSlot(0, 0, null, psy.id);
    return useBoxStore.getState().profile.teams[0].slots[0].psychubeId === null;
  })(),
);
check(
  "same-team psychube reuse is independent of displayed imprint",
  (() => {
    fresh();
    const s = useBoxStore.getState();
    s.addCharacter(a.id);
    s.addCharacter(b.id);
    s.setPsychubeImprint(psy.id, 1);
    s.assignSlot(0, 0, a.id, psy.id);
    s.assignSlot(0, 1, b.id, psy.id);
    return (
      useBoxStore.getState().profile.teams[0].slots[0].psychubeId === psy.id &&
      useBoxStore.getState().profile.teams[0].slots[1].psychubeId === psy.id
    );
  })(),
);
check(
  "regular character rejects a second psychube",
  (() => {
    fresh();
    const s = useBoxStore.getState();
    s.addCharacter(a.id);
    s.addPsychube(psy.id);
    s.addPsychube(twinsPsy1.id);
    s.assignSlot(0, 0, a.id, psy.id, twinsPsy1.id);
    const slot = useBoxStore.getState().profile.teams[0].slots[0];
    return slot.psychubeId === psy.id && slot.psychubeId2 === null;
  })(),
);
check(
  "The Twins auto-owns and equips the paired psychube",
  (() => {
    fresh();
    const s = useBoxStore.getState();
    s.addCharacter(twins.id);
    s.addPsychube(twinsPsy1.id);
    s.assignSlot(0, 0, twins.id, twinsPsy1.id);
    const profile = useBoxStore.getState().profile;
    const slot = profile.teams[0].slots[0];
    return (
      profile.psychubes[twinsPsy2.id] === 1 &&
      slot.psychubeId === twinsPsy1.id &&
      slot.psychubeId2 === twinsPsy2.id
    );
  })(),
);
check(
  "team names clamp to 12 characters and survive clear",
  (() => {
    fresh();
    const s = useBoxStore.getState();
    s.setTeamName(0, "ABCDEFGHIJKLMNO");
    s.clearTeam(0);
    return useBoxStore.getState().profile.teams[0].name === "ABCDEFGHIJKL";
  })(),
);
check(
  "psychube imprint can decrease independently of team usage",
  (() => {
    fresh();
    const s = useBoxStore.getState();
    s.addCharacter(a.id);
    s.addCharacter(b.id);
    s.setPsychubeImprint(psy.id, 2);
    s.assignSlot(0, 0, a.id, psy.id);
    s.assignSlot(0, 1, b.id, psy.id);
    s.setPsychubeImprint(psy.id, 1);
    return (
      useBoxStore.getState().profile.psychubes[psy.id] === 1 &&
      useBoxStore.getState().profile.teams[0].slots[1].psychubeId === psy.id
    );
  })(),
);
check(
  "psychube imprint caps at 5",
  (() => {
    fresh();
    useBoxStore.getState().setPsychubeImprint(psy.id, 99);
    return useBoxStore.getState().profile.psychubes[psy.id] === 5;
  })(),
);
check(
  "removing character clears whole slot",
  (() => {
    fresh();
    const s = useBoxStore.getState();
    s.addCharacter(a.id);
    s.setPsychubeImprint(psy.id, 1);
    s.assignSlot(0, 0, a.id, psy.id);
    s.removeCharacter(a.id);
    const slot = useBoxStore.getState().profile.teams[0].slots[0];
    return slot.characterId === null && slot.psychubeId === null;
  })(),
);
check(
  "Future Sight off blocks adding unreleased character",
  (() => {
    fresh();
    const future = fixtureCharacters[2];
    useBoxStore.getState().addCharacter(future.id);
    return !useBoxStore.getState().profile.characters[future.id];
  })(),
);
check(
  "Future Sight on allows and off preserves unreleased character",
  (() => {
    fresh();
    const future = fixtureCharacters[2];
    useBoxStore.getState().setShowFutureSight(true);
    useBoxStore.getState().addCharacter(future.id);
    useBoxStore.getState().setShowFutureSight(false);
    return !!useBoxStore.getState().profile.characters[future.id];
  })(),
);
check(
  "Future Sight off blocks adding unreleased psychube",
  (() => {
    fresh();
    const futurePsychube = fixturePsychubes.find((item) => !item.released)!;
    useBoxStore.getState().addPsychube(futurePsychube.id);
    return !useBoxStore.getState().profile.psychubes[futurePsychube.id];
  })(),
);
check(
  "Future Sight on allows and off preserves unreleased psychube",
  (() => {
    fresh();
    const futurePsychube = fixturePsychubes.find((item) => !item.released)!;
    useBoxStore.getState().setShowFutureSight(true);
    useBoxStore.getState().addPsychube(futurePsychube.id);
    useBoxStore.getState().setShowFutureSight(false);
    return useBoxStore.getState().profile.psychubes[futurePsychube.id] === 1;
  })(),
);
check(
  "profile with only an unreleased psychube requires Future Sight confirmation",
  (() => {
    const profile = emptyProfile();
    const futurePsychube = fixturePsychubes.find((item) => !item.released)!;
    profile.psychubes[futurePsychube.id] = 1;
    return profileHasFutureContent(profile);
  })(),
);
check(
  "profile with only a released psychube does not require Future Sight confirmation",
  (() => {
    const profile = emptyProfile();
    const releasedPsychube = fixturePsychubes.find((item) => item.released)!;
    profile.psychubes[releasedPsychube.id] = 1;
    return !profileHasFutureContent(profile);
  })(),
);
check(
  "Future Sight off blocks selecting unreleased skin",
  (() => {
    fresh();
    useBoxStore.getState().addCharacter(a.id);
    const futureSkin = a.skins.find((skin) => !skin.released)!;
    useBoxStore.getState().setActiveVariant(a.id, futureSkin.id);
    return (
      useBoxStore.getState().profile.characters[a.id].activeVariant === null
    );
  })(),
);
check(
  "preview spoiler approval controls domain selection",
  (() => {
    fresh();
    const future = fixtureCharacters[2];
    useBoxStore.getState().enterPreview(emptyProfile(), false);
    useBoxStore.getState().addCharacter(future.id);
    const blocked =
      !useBoxStore.getState().previewProfile?.characters[future.id];
    useBoxStore.getState().setPreviewShowFutureSight(true);
    useBoxStore.getState().addCharacter(future.id);
    return (
      blocked && !!useBoxStore.getState().previewProfile?.characters[future.id]
    );
  })(),
);
check(
  "Future Sight off blocks newly assigning stored future character",
  (() => {
    fresh();
    const future = fixtureCharacters[2];
    useBoxStore.getState().setShowFutureSight(true);
    useBoxStore.getState().addCharacter(future.id);
    useBoxStore.getState().assignSlot(0, 0, future.id, null);
    useBoxStore.getState().setShowFutureSight(false);
    useBoxStore.getState().assignSlot(1, 0, future.id, null);
    const profile = useBoxStore.getState().profile;
    return (
      profile.teams[0].slots[0].characterId === future.id &&
      profile.teams[1].slots[0].characterId === null
    );
  })(),
);
check(
  "valid unreleased skin survives sanitize",
  (() => {
    fresh();
    const future = a.skins.at(-1)!;
    const p = emptyProfile();
    p.characters[a.id] = { ...ADD_DEFAULT, activeVariant: future.id };
    const clean = sanitizeProfile(p);
    return clean.characters[a.id].activeVariant === future.id;
  })(),
);
check(
  "stale skin falls back without dropping character",
  (() => {
    const p = emptyProfile();
    p.characters[a.id] = { ...ADD_DEFAULT, activeVariant: "999999" };
    const clean = sanitizeProfile(p);
    return clean.characters[a.id].activeVariant === null;
  })(),
);
check(
  "preview edits never mutate local",
  (() => {
    fresh();
    useBoxStore.getState().addCharacter(a.id);
    const before = JSON.stringify(useBoxStore.getState().profile);
    useBoxStore.getState().enterPreview(emptyProfile());
    useBoxStore.getState().addCharacter(b.id);
    return (
      JSON.stringify(useBoxStore.getState().profile) === before &&
      !!useBoxStore.getState().previewProfile?.characters[b.id]
    );
  })(),
);
check(
  "preview import replaces local",
  (() => {
    fresh();
    useBoxStore.getState().addCharacter(a.id);
    const preview = emptyProfile();
    const future = fixtureCharacters[2];
    preview.characters[future.id] = { ...ADD_DEFAULT, activeVariant: null };
    useBoxStore.getState().enterPreview(preview, true);
    useBoxStore.getState().importPreview();
    const state = useBoxStore.getState();
    return (
      !state.profile.characters[a.id] &&
      !!state.profile.characters[future.id] &&
      !state.activeIsPreview &&
      !state.preferences.showFutureSight
    );
  })(),
);
check(
  "current persisted envelope sanitizes untrusted profile",
  (() => {
    const migrated = migratePersistedState({
      profile: {
        characters: { [a.id]: { ...ADD_DEFAULT, activeVariant: null } },
        psychubes: {},
        teams: [],
      },
      preferences: {},
    });
    return (
      !!migrated.profile.characters[a.id] && migrated.profile.teams.length === 4
    );
  })(),
);
check(
  "preview import can explicitly enable Future Sight",
  (() => {
    fresh();
    const preview = emptyProfile();
    const future = fixtureCharacters[2];
    preview.characters[future.id] = { ...ADD_DEFAULT, activeVariant: null };
    useBoxStore.getState().enterPreview(preview, true);
    useBoxStore.getState().importPreview(true);
    const state = useBoxStore.getState();
    return (
      !!state.profile.characters[future.id] &&
      state.preferences.showFutureSight &&
      !state.activeIsPreview
    );
  })(),
);
check(
  "preview and transient UI are not persisted",
  (() => {
    fresh();
    useBoxStore.getState().enterPreview(emptyProfile());
    const partial = useBoxStore.persist
      .getOptions()
      .partialize?.(useBoxStore.getState()) as Record<string, unknown>;
    return (
      !("previewProfile" in partial) &&
      !("activeIsPreview" in partial) &&
      !("ui" in partial) &&
      "preferences" in partial
    );
  })(),
);
check(
  "Future Sight preference persists separately",
  (() => {
    fresh();
    useBoxStore.getState().setShowFutureSight(true);
    const partial = useBoxStore.persist
      .getOptions()
      .partialize?.(useBoxStore.getState()) as {
      preferences?: { showFutureSight?: boolean };
    };
    return partial.preferences?.showFutureSight === true;
  })(),
);
console.log(`\nstore tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
