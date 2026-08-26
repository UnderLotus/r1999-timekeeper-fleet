import {
  ADD_DEFAULT,
  migratePersistedState,
  useBoxStore,
} from "../src/store/boxStore";
import { emptyProfile } from "../src/types/profile";
import { setCatalogForTesting } from "../src/utils/catalog";
import { fixtureCharacters } from "./test-fixtures";

setCatalogForTesting(fixtureCharacters, []);

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
      assignmentPreviousFilter: null,
    },
    preferences: {
      lang: "zh-TW",
      langChosen: false,
      showFutureSight: false,
      addDefaults: { ...ADD_DEFAULT },
      defaultSkinMode: "initial",
      psychubeImprintDefault: 1,
    },
  });
  return useBoxStore.getState();
}
const a = fixtureCharacters[0];
const b = fixtureCharacters[1];
const future = fixtureCharacters[2];

check(
  "store starts with a four-team, four-slot local profile",
  (() => {
    const state = fresh();
    return (
      !state.activeIsPreview &&
      state.profile.teams.length === 4 &&
      state.profile.teams.every((team) => team.slots.length === 4)
    );
  })(),
);
check(
  "local active-profile routing delegates mutations to local data",
  (() => {
    fresh();
    useBoxStore.getState().addCharacter(a.id);
    return !!useBoxStore.getState().profile.characters[a.id];
  })(),
);
check(
  "preview active-profile routing never mutates local data",
  (() => {
    fresh();
    useBoxStore.getState().addCharacter(a.id);
    const before = JSON.stringify(useBoxStore.getState().profile);
    useBoxStore.getState().enterPreview(emptyProfile());
    useBoxStore.getState().addCharacter(b.id);
    const state = useBoxStore.getState();
    return (
      state.activeIsPreview &&
      JSON.stringify(state.profile) === before &&
      !!state.previewProfile?.characters[b.id]
    );
  })(),
);
check(
  "preview entry sanitizes the incoming profile and clears assignment UI",
  (() => {
    fresh();
    useBoxStore.getState().setAssignment({
      team: 0,
      slot: 0,
      kind: "character",
    });
    const incoming = emptyProfile();
    incoming.characters[a.id] = { ...ADD_DEFAULT, activeVariant: "stale" };
    useBoxStore.getState().enterPreview(incoming, true);
    const state = useBoxStore.getState();
    return (
      state.previewShowFutureSight &&
      state.ui.assignment === null &&
      state.previewProfile?.characters[a.id].activeVariant === null
    );
  })(),
);
check(
  "preview Future Sight state is separate from local preferences",
  (() => {
    fresh();
    useBoxStore.getState().setShowFutureSight(true);
    useBoxStore.getState().enterPreview(emptyProfile(), false);
    useBoxStore.getState().setPreviewShowFutureSight(true);
    const state = useBoxStore.getState();
    return state.preferences.showFutureSight && state.previewShowFutureSight;
  })(),
);
check(
  "leaving preview discards preview data and transient assignment",
  (() => {
    fresh();
    useBoxStore.getState().enterPreview(emptyProfile());
    useBoxStore.getState().addCharacter(a.id);
    useBoxStore.getState().setAssignment({
      team: 0,
      slot: 0,
      kind: "character",
    });
    useBoxStore.getState().exitPreview();
    const state = useBoxStore.getState();
    return (
      !state.activeIsPreview &&
      state.previewProfile === null &&
      state.previewShowFutureSight === false &&
      state.ui.assignment === null &&
      !state.profile.characters[a.id]
    );
  })(),
);
check(
  "import preview replaces local and keeps Future Sight hidden by default",
  (() => {
    fresh();
    useBoxStore.getState().addCharacter(a.id);
    const incoming = emptyProfile();
    incoming.characters[future.id] = { ...ADD_DEFAULT, activeVariant: null };
    useBoxStore.getState().enterPreview(incoming, true);
    useBoxStore.getState().importPreview(false);
    const state = useBoxStore.getState();
    return (
      !state.activeIsPreview &&
      state.previewProfile === null &&
      !state.profile.characters[a.id] &&
      !!state.profile.characters[future.id] &&
      !state.preferences.showFutureSight
    );
  })(),
);
check(
  "import preview can explicitly enable local Future Sight",
  (() => {
    fresh();
    const incoming = emptyProfile();
    incoming.characters[future.id] = { ...ADD_DEFAULT, activeVariant: null };
    useBoxStore.getState().enterPreview(incoming, true);
    useBoxStore.getState().importPreview(true);
    const state = useBoxStore.getState();
    return !!state.profile.characters[future.id] && state.preferences.showFutureSight;
  })(),
);
check(
  "persisted state migration returns sanitized profile and preferences",
  (() => {
    const migrated = migratePersistedState({
      profile: {
        characters: { [a.id]: { ...ADD_DEFAULT, activeVariant: "stale" } },
        psychubes: {},
        teams: [],
      },
      preferences: {},
    });
    return (
      !!migrated.profile.characters[a.id] &&
      migrated.profile.characters[a.id].activeVariant === null &&
      migrated.profile.teams.length === 4 &&
      migrated.preferences.psychubeImprintDefault === 1
    );
  })(),
);
check(
  "persistence contains only local profile and preferences",
  (() => {
    fresh();
    useBoxStore.getState().enterPreview(emptyProfile());
    const partial = useBoxStore.persist
      .getOptions()
      .partialize?.(useBoxStore.getState()) as Record<string, unknown>;
    return (
      Object.keys(partial).sort().join(",") === "preferences,profile" &&
      !partial.previewProfile &&
      !partial.activeIsPreview &&
      !partial.ui
    );
  })(),
);
check(
  "Future Sight preference is persisted independently of preview state",
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
