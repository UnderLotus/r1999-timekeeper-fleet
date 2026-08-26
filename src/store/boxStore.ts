import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { detectLanguage } from "../i18n/detect-language";
import type { CharacterBuild, Profile } from "../types/profile";
import { emptyProfile, PSYCHUBE_IMPRINT_MAX } from "../types/profile";
import type { InsightIndex, LangCode } from "../types/catalog";
import {
  getCharacter,
  profileMutationCatalog,
  resolveVariant,
} from "../utils/catalog";
import { createSafeStorage } from "../utils/storage";
import { ADD_DEFAULT, sanitizeProfile } from "../utils/profile-sanitize";
import {
  createProfileMutationEngine,
  type ProfileMutation,
} from "../utils/profile-mutations";
import {
  createPoolUiState,
  reducePoolUi,
  type Assignment,
  type DefaultSkinMode,
  type FilterMode,
  type PoolUiState,
} from "../utils/pool-model";
export { ADD_DEFAULT, sanitizeProfile } from "../utils/profile-sanitize";
export { characterRefs, psychubeRefs } from "../utils/profile-mutations";
export type { Assignment, DefaultSkinMode, FilterMode } from "../utils/pool-model";
export type { PoolUiState as UIState } from "../utils/pool-model";

const STORAGE_KEY = "r1999-timekeeper-fleet-state";
const PERSIST_VERSION = 3;
export interface Preferences {
  lang: LangCode;
  langChosen: boolean;
  showFutureSight: boolean;
  addDefaults: Omit<CharacterBuild, "activeVariant">;
  defaultSkinMode: DefaultSkinMode;
  psychubeImprintDefault: number;
}

export interface BoxStore {
  profile: Profile;
  previewProfile: Profile | null;
  activeIsPreview: boolean;
  previewShowFutureSight: boolean;
  ui: PoolUiState;
  preferences: Preferences;
  _setActiveProfile: (profile: Profile) => void;
  enterPreview: (profile: Profile, showFutureSight?: boolean) => void;
  setPreviewShowFutureSight: (value: boolean) => void;
  exitPreview: () => void;
  importPreview: (enableFutureSight?: boolean) => void;
  addCharacter: (id: string) => void;
  removeCharacter: (id: string) => void;
  setInsight: (id: string, value: InsightIndex) => void;
  setLevel: (id: string, value: number) => void;
  setResonance: (id: string, value: number) => void;
  setPortray: (id: string, value: number) => void;
  setActiveVariant: (id: string, value: string | null) => void;
  addPsychube: (id: string) => void;
  setPsychubeImprint: (id: string, imprint: number) => void;
  removePsychube: (id: string) => void;
  assignSlot: (
    team: number,
    slot: number,
    characterId: string | null,
    psychubeId: string | null,
    psychubeId2?: string | null,
  ) => boolean;
  setTeamName: (team: number, name: string) => void;
  swapSlots: (team: number, a: number, b: number) => void;
  clearTeam: (team: number) => void;
  resetAll: () => void;
  setTab: (tab: PoolUiState["tab"]) => void;
  setSearch: (value: string) => void;
  setFilterMode: (value: FilterMode) => void;
  setRarityFilter: (value: number[]) => void;
  setAssignment: (value: Assignment | null) => void;
  initializeLanguage: (browserLocale: string) => void;
  setLang: (value: LangCode) => void;
  setShowFutureSight: (value: boolean) => void;
  setAddDefaults: (
    value: Partial<Omit<CharacterBuild, "activeVariant">>,
  ) => void;
  setDefaultSkinMode: (value: DefaultSkinMode) => void;
  setPsychubeImprintDefault: (value: number) => void;
  setAllPsychubesOwned: (owned: boolean, imprint: number) => void;
}

const DEFAULT_UI: PoolUiState = createPoolUiState();
const DEFAULT_PREFERENCES: Preferences = {
  lang: "zh-TW",
  langChosen: false,
  showFutureSight: false,
  addDefaults: { ...ADD_DEFAULT },
  defaultSkinMode: "initial",
  psychubeImprintDefault: 1,
};
function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizePreferences(value: unknown): Preferences {
  if (!record(value))
    return { ...DEFAULT_PREFERENCES, addDefaults: { ...ADD_DEFAULT } };
  const validLang: LangCode[] = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];
  const lang = validLang.includes(value.lang as LangCode)
    ? (value.lang as LangCode)
    : "zh-TW";
  const defaults = record(value.addDefaults) ? value.addDefaults : {};
  return {
    lang,
    langChosen: value.langChosen === true,
    showFutureSight: value.showFutureSight === true,
    defaultSkinMode:
      value.defaultSkinMode === "insight" ? "insight" : "initial",
    psychubeImprintDefault: Math.min(
      PSYCHUBE_IMPRINT_MAX,
      Math.max(1, Math.trunc(finite(value.psychubeImprintDefault, 1)) || 1),
    ),
    addDefaults: {
      insight: Math.min(
        3,
        Math.max(0, Math.trunc(finite(defaults.insight, ADD_DEFAULT.insight))),
      ) as InsightIndex,
      level: Math.min(
        60,
        Math.max(1, Math.trunc(finite(defaults.level, ADD_DEFAULT.level))),
      ),
      portray: Math.min(
        5,
        Math.max(0, Math.trunc(finite(defaults.portray, ADD_DEFAULT.portray))),
      ),
      resonance: Math.min(
        15,
        Math.max(
          0,
          Math.trunc(finite(defaults.resonance, ADD_DEFAULT.resonance)),
        ),
      ),
    },
  };
}
function active(get: () => BoxStore): Profile {
  return get().activeIsPreview
    ? (get().previewProfile ?? emptyProfile())
    : get().profile;
}

export function migratePersistedState(persisted: unknown): {
  profile: Profile;
  preferences: Preferences;
} {
  if (!record(persisted)) {
    return {
      profile: emptyProfile(),
      preferences: { ...DEFAULT_PREFERENCES, addDefaults: { ...ADD_DEFAULT } },
    };
  }
  return {
    profile: sanitizeProfile(persisted.profile),
    preferences: sanitizePreferences(persisted.preferences),
  };
}

const profileMutationEngine = createProfileMutationEngine(
  profileMutationCatalog,
);

function futureSelectionAllowed(get: () => BoxStore): boolean {
  return get().activeIsPreview
    ? get().previewShowFutureSight
    : get().preferences.showFutureSight;
}
function mutateActive(
  get: () => BoxStore,
  mutation: ProfileMutation,
): boolean {
  const state = get();
  const outcome = profileMutationEngine.mutateProfile(active(get), mutation, {
    allowFutureSight: futureSelectionAllowed(get),
    addDefaults: state.preferences.addDefaults,
    defaultSkinMode: state.preferences.defaultSkinMode,
    psychubeAmplificationDefault: state.preferences.psychubeImprintDefault,
  });
  if (outcome.changed) state._setActiveProfile(outcome.profile);
  return outcome.changed;
}
export const useBoxStore = create<BoxStore>()(
  persist(
    (set, get) => ({
      profile: emptyProfile(),
      previewProfile: null,
      activeIsPreview: false,
      previewShowFutureSight: false,
      ui: { ...DEFAULT_UI },
      preferences: { ...DEFAULT_PREFERENCES, addDefaults: { ...ADD_DEFAULT } },
      _setActiveProfile: (profile) =>
        get().activeIsPreview
          ? set({ previewProfile: profile })
          : set({ profile }),
      enterPreview: (profile, showFutureSight = false) =>
        set({
          previewProfile: sanitizeProfile(profile),
          activeIsPreview: true,
          previewShowFutureSight: showFutureSight,
          ui: reducePoolUi(get().ui, {
            type: "setAssignment",
            assignment: null,
          }),
        }),
      setPreviewShowFutureSight: (previewShowFutureSight) =>
        set({ previewShowFutureSight }),
      exitPreview: () =>
        set({
          previewProfile: null,
          activeIsPreview: false,
          previewShowFutureSight: false,
          ui: reducePoolUi(get().ui, {
            type: "setAssignment",
            assignment: null,
          }),
        }),
      importPreview: (enableFutureSight = false) => {
        const preview = get().previewProfile;
        if (!get().activeIsPreview || !preview) return;
        set({
          profile: sanitizeProfile(preview),
          previewProfile: null,
          activeIsPreview: false,
          previewShowFutureSight: false,
          preferences: enableFutureSight
            ? { ...get().preferences, showFutureSight: true }
            : get().preferences,
          ui: reducePoolUi(get().ui, {
            type: "setAssignment",
            assignment: null,
          }),
        });
      },
      addCharacter: (id) => {
        mutateActive(get, { type: "addCharacter", id });
      },
      removeCharacter: (id) => {
        mutateActive(get, { type: "removeCharacter", id });
      },
      setInsight: (id, value) => {
        mutateActive(get, { type: "setInsight", id, value });
      },
      setLevel: (id, value) => {
        mutateActive(get, { type: "setLevel", id, value });
      },
      setResonance: (id, value) => {
        mutateActive(get, { type: "setResonance", id, value });
      },
      setPortray: (id, value) => {
        mutateActive(get, { type: "setPortray", id, value });
      },
      setActiveVariant: (id, value) => {
        mutateActive(get, { type: "setActiveVariant", id, value });
      },
      addPsychube: (id) => {
        mutateActive(get, { type: "addPsychube", id });
      },
      setPsychubeImprint: (id, imprint) => {
        mutateActive(get, {
          type: "setPsychubeAmplification",
          id,
          value: imprint,
        });
      },
      removePsychube: (id) => {
        mutateActive(get, { type: "removePsychube", id });
      },
      assignSlot: (
        team,
        slot,
        characterId,
        psychubeId,
        psychubeId2 = null,
      ) =>
        mutateActive(get, {
          type: "assignSlot",
          team,
          slot,
          characterId,
          psychubeId,
          psychubeId2,
        }),
      setTeamName: (team, name) => {
        mutateActive(get, { type: "setTeamName", team, name });
      },
      swapSlots: (team, a, b) => {
        mutateActive(get, { type: "swapSlots", team, a, b });
      },
      clearTeam: (team) => {
        mutateActive(get, { type: "clearTeam", team });
      },
      resetAll: () => {
        mutateActive(get, { type: "reset" });
      },
      setTab: (tab) =>
        set({ ui: reducePoolUi(get().ui, { type: "setTab", tab }) }),
      setSearch: (search) =>
        set({ ui: reducePoolUi(get().ui, { type: "setSearch", search }) }),
      setFilterMode: (filterMode) =>
        set({
          ui: reducePoolUi(get().ui, { type: "setFilterMode", filterMode }),
        }),
      setRarityFilter: (rarityFilter) =>
        set({
          ui: reducePoolUi(get().ui, {
            type: "setRarityFilter",
            rarityFilter,
          }),
        }),
      setAssignment: (assignment) =>
        set({
          ui: reducePoolUi(get().ui, { type: "setAssignment", assignment }),
        }),
      initializeLanguage: (browserLocale) => {
        const preferences = get().preferences;
        if (preferences.langChosen) return;
        set({
          preferences: {
            ...preferences,
            lang: detectLanguage(browserLocale),
            langChosen: true,
          },
        });
      },
      setLang: (lang) =>
        set({ preferences: { ...get().preferences, lang, langChosen: true } }),
      setShowFutureSight: (showFutureSight) =>
        set({ preferences: { ...get().preferences, showFutureSight } }),
      setAddDefaults: (value) =>
        set({
          preferences: sanitizePreferences({
            ...get().preferences,
            addDefaults: { ...get().preferences.addDefaults, ...value },
          }),
        }),
      setDefaultSkinMode: (defaultSkinMode) =>
        set({ preferences: { ...get().preferences, defaultSkinMode } }),
      setPsychubeImprintDefault: (psychubeImprintDefault) =>
        set({
          preferences: sanitizePreferences({
            ...get().preferences,
            psychubeImprintDefault,
          }),
        }),
      setAllPsychubesOwned: (owned, imprint) => {
        mutateActive(get, {
          type: "setAllPsychubesOwned",
          owned,
          amplification: imprint,
        });
      },
    }),
    {
      name: STORAGE_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(createSafeStorage),
      partialize: (state) =>
        ({ profile: state.profile, preferences: state.preferences }) as Pick<
          BoxStore,
          "profile" | "preferences"
        >,
      migrate: (persisted) => migratePersistedState(persisted),
      merge: (persisted, current) => {
        const value = record(persisted) ? persisted : {};
        return {
          ...current,
          profile: sanitizeProfile(value.profile),
          preferences: sanitizePreferences(value.preferences),
        };
      },
    },
  ),
);

export function onHydrated(callback: () => void): () => void {
  if (useBoxStore.persist.hasHydrated()) {
    callback();
    return () => {};
  }
  return useBoxStore.persist.onFinishHydration(callback);
}
export function resolveBuildVariant(
  id: string,
  activeVariant: string | null,
): string | null {
  const def = getCharacter(id);
  return def ? resolveVariant(def, activeVariant).id : null;
}
