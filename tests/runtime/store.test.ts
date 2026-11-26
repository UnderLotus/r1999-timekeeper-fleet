import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  ADD_DEFAULT,
  migratePersistedState,
  useBoxStore,
} from "../../src/store/boxStore";
import { emptyProfile } from "../../src/types/profile";
import { setCatalogForTesting } from "../../src/utils/catalog";
import {
  CHAR_FUTURE,
  CHAR_MISTLETOE,
  CHAR_SONETTO,
  fixtureCharacters,
  fixturePsychubes,
} from "../helpers/catalog-fixtures";

function resetStore(): void {
  useBoxStore.setState({
    profile: emptyProfile(),
    previewProfile: null,
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
}

describe("boxStore", () => {
  beforeEach(() => {
    setCatalogForTesting(fixtureCharacters, fixturePsychubes);
    resetStore();
  });

  it("routes edits to local profile when not previewing, and isolates preview edits from local", () => {
    useBoxStore.getState().addCharacter(CHAR_MISTLETOE.id);
    assert.ok(useBoxStore.getState().profile.characters[CHAR_MISTLETOE.id]);

    const localSnapshot = structuredClone(useBoxStore.getState().profile);
    useBoxStore.getState().enterPreview(emptyProfile());
    useBoxStore.getState().addCharacter(CHAR_SONETTO.id);

    const state = useBoxStore.getState();
    assert.notEqual(state.previewProfile, null);
    assert.deepEqual(state.profile, localSnapshot);
    assert.ok(state.previewProfile?.characters[CHAR_SONETTO.id]);
  });

  it("sanitizes incoming preview profile, clears transient assignment, and isolates preview Future Sight", () => {
    useBoxStore.getState().setShowFutureSight(true);
    useBoxStore.getState().setAssignment({
      team: 0,
      slot: 0,
      kind: "character",
    });

    const incoming = emptyProfile();
    incoming.characters[CHAR_MISTLETOE.id] = {
      ...ADD_DEFAULT,
      activeVariant: "stale",
    };
    useBoxStore.getState().enterPreview(incoming, false);
    assert.equal(useBoxStore.getState().previewShowFutureSight, false);
    assert.equal(useBoxStore.getState().preferences.showFutureSight, true);
    assert.equal(useBoxStore.getState().ui.assignment, null);
    assert.equal(
      useBoxStore.getState().previewProfile?.characters[CHAR_MISTLETOE.id]
        .activeVariant,
      null,
    );

    useBoxStore.getState().setPreviewShowFutureSight(true);
    assert.equal(useBoxStore.getState().previewShowFutureSight, true);
  });

  it("discards preview data and transient assignment on exitPreview", () => {
    useBoxStore.getState().enterPreview(emptyProfile());
    useBoxStore.getState().addCharacter(CHAR_MISTLETOE.id);
    useBoxStore.getState().setAssignment({
      team: 0,
      slot: 0,
      kind: "character",
    });

    useBoxStore.getState().exitPreview();
    const state = useBoxStore.getState();
    assert.equal(state.previewProfile, null);
    assert.equal(state.previewShowFutureSight, false);
    assert.equal(state.ui.assignment, null);
    assert.equal(state.profile.characters[CHAR_MISTLETOE.id], undefined);
  });

  it("replaces local profile on importPreview and handles Future Sight opt-in without turning off existing local Future Sight", () => {
    for (const [initialLocal, enableOnImport, expectedLocal] of [
      [false, false, false],
      [false, true, true],
      [true, false, true],
    ] as const) {
      resetStore();
      useBoxStore.getState().setShowFutureSight(initialLocal);
      useBoxStore.getState().addCharacter(CHAR_MISTLETOE.id);

      const incoming = emptyProfile();
      incoming.characters[CHAR_FUTURE.id] = {
        ...ADD_DEFAULT,
        activeVariant: null,
      };
      useBoxStore.getState().enterPreview(incoming, true);
      useBoxStore.getState().importPreview(enableOnImport);

      const state = useBoxStore.getState();
      assert.equal(state.previewProfile, null);
      assert.equal(state.profile.characters[CHAR_MISTLETOE.id], undefined);
      assert.ok(state.profile.characters[CHAR_FUTURE.id]);
      assert.equal(state.preferences.showFutureSight, expectedLocal);
    }
  });

  it("locks browser language detection once and never overwrites a manual choice", () => {
    useBoxStore.getState().initializeLanguage("zh-SG");
    assert.equal(useBoxStore.getState().preferences.lang, "zh-CN");
    assert.equal(useBoxStore.getState().preferences.langChosen, true);

    useBoxStore.getState().initializeLanguage("ja-JP");
    assert.equal(useBoxStore.getState().preferences.lang, "zh-CN");

    resetStore();
    useBoxStore.getState().setLang("ko-KR");
    useBoxStore.getState().initializeLanguage("zh-CN");
    assert.equal(useBoxStore.getState().preferences.lang, "ko-KR");
    assert.equal(useBoxStore.getState().preferences.langChosen, true);
  });

  it("sanitizes preference defaults, persisted migration, and persists only local profile and preferences", () => {
    useBoxStore.getState().setAddDefaults({
      insight: 9 as 3,
      level: 999,
      portray: -1,
      resonance: 99,
    });
    useBoxStore.getState().setPsychubeImprintDefault(99);
    assert.deepEqual(useBoxStore.getState().preferences.addDefaults, {
      insight: 3,
      level: 60,
      portray: 0,
      resonance: 15,
    });
    assert.equal(useBoxStore.getState().preferences.psychubeImprintDefault, 5);

    const migrated = migratePersistedState({
      profile: {
        characters: {
          [CHAR_MISTLETOE.id]: { ...ADD_DEFAULT, activeVariant: "stale" },
        },
        psychubes: {},
        teams: [],
      },
      preferences: {},
    });
    assert.equal(
      migrated.profile.characters[CHAR_MISTLETOE.id].activeVariant,
      null,
    );
    assert.equal(migrated.profile.teams.length, 4);
    assert.equal(migrated.preferences.psychubeImprintDefault, 1);

    useBoxStore.getState().enterPreview(emptyProfile());
    const partial = useBoxStore.persist
      .getOptions()
      .partialize?.(useBoxStore.getState()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(partial).sort(), ["preferences", "profile"]);
    assert.equal(partial.previewProfile, undefined);
    assert.equal(partial.ui, undefined);
  });
});
