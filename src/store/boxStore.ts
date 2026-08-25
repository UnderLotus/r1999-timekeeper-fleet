import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { detectLanguage } from "../i18n/detect-language";
import type { CharacterBuild, Profile } from "../types/profile";
import {
  emptyProfile,
  LEVEL_CAPS,
  normalizeTeamName,
  PORTRAY_MAX,
  PSYCHUBE_IMPRINT_MAX,
  RESONANCE_MAX,
  SLOTS_PER_TEAM,
  TEAM_COUNT,
} from "../types/profile";
import type { InsightIndex, LangCode } from "../types/catalog";
import {
  allPsychubes,
  getCharacter,
  getPsychube,
  legalInsights,
  resolveVariant,
} from "../utils/catalog";
import { createSafeStorage } from "../utils/storage";
import { ADD_DEFAULT, sanitizeProfile } from "../utils/profile-sanitize";
export { ADD_DEFAULT, sanitizeProfile } from "../utils/profile-sanitize";

const STORAGE_KEY = "r1999-timekeeper-fleet-state";
const PERSIST_VERSION = 3;
export type FilterMode = "all" | "owned" | "unowned";
export type DefaultSkinMode = "initial" | "insight";
export interface Assignment {
  team: number;
  slot: number;
  kind: "character" | "psychube";
  psychubeIndex?: 0 | 1;
}
export interface UIState {
  tab: "characters" | "psychubes";
  search: string;
  filterMode: FilterMode;
  rarityFilter: number[];
  assignment: Assignment | null;
}
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
  ui: UIState;
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
  setTab: (tab: UIState["tab"]) => void;
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

const DEFAULT_UI: UIState = {
  tab: "characters",
  search: "",
  filterMode: "all",
  rarityFilter: [],
  assignment: null,
};
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

function futureSelectionAllowed(get: () => BoxStore): boolean {
  return get().activeIsPreview
    ? get().previewShowFutureSight
    : get().preferences.showFutureSight;
}
export function characterRefs(
  profile: Profile,
  id: string,
): Array<{ team: number; slot: number }> {
  const refs: Array<{ team: number; slot: number }> = [];
  profile.teams.forEach((team, ti) =>
    team.slots.forEach((slot, si) => {
      if (slot.characterId === id) refs.push({ team: ti, slot: si });
    }),
  );
  return refs;
}
export function psychubeRefs(
  profile: Profile,
  id: string,
): Array<{ team: number; slot: number }> {
  const refs: Array<{ team: number; slot: number }> = [];
  profile.teams.forEach((team, ti) =>
    team.slots.forEach((slot, si) => {
      if (slot.psychubeId === id || slot.psychubeId2 === id)
        refs.push({ team: ti, slot: si });
    }),
  );
  return refs;
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
          ui: { ...get().ui, assignment: null },
        }),
      setPreviewShowFutureSight: (previewShowFutureSight) =>
        set({ previewShowFutureSight }),
      exitPreview: () =>
        set({
          previewProfile: null,
          activeIsPreview: false,
          previewShowFutureSight: false,
          ui: { ...get().ui, assignment: null },
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
          ui: { ...get().ui, assignment: null },
        });
      },
      addCharacter: (id) => {
        const def = getCharacter(id),
          profile = active(get);
        if (
          !def ||
          profile.characters[id] ||
          (!def.released && !futureSelectionAllowed(get))
        )
          return;
        const { addDefaults: d, defaultSkinMode } = get().preferences;
        const insight = Math.min(def.maxInsight, d.insight) as InsightIndex;
        const activeVariant =
          defaultSkinMode === "insight"
            ? (def.skins.find(
                (skin) =>
                  skin.type === "insight" &&
                  (skin.released !== false || futureSelectionAllowed(get)),
              )?.id ?? null)
            : null;
        const build: CharacterBuild = {
          ...d,
          insight,
          level: Math.min(d.level, LEVEL_CAPS[insight]),
          activeVariant,
        };
        get()._setActiveProfile({
          ...profile,
          characters: { ...profile.characters, [id]: build },
        });
      },
      removeCharacter: (id) => {
        const profile = active(get);
        if (!profile.characters[id]) return;
        const characters = { ...profile.characters };
        delete characters[id];
        const teams = profile.teams.map((team) => ({
          ...team,
          slots: team.slots.map((slot) =>
            slot.characterId === id
              ? {
                  characterId: null,
                  psychubeId: null,
                  psychubeId2: null,
                }
              : { ...slot },
          ),
        }));
        get()._setActiveProfile({ ...profile, characters, teams });
      },
      setInsight: (id, value) => {
        const profile = active(get),
          def = getCharacter(id),
          build = profile.characters[id];
        if (!def || !build || !legalInsights(def).includes(value)) return;
        get()._setActiveProfile({
          ...profile,
          characters: {
            ...profile.characters,
            [id]: {
              ...build,
              insight: value,
              level: Math.min(build.level, LEVEL_CAPS[value]),
            },
          },
        });
      },
      setLevel: (id, value) => {
        const profile = active(get),
          build = profile.characters[id];
        if (!build) return;
        const level = Math.min(
          LEVEL_CAPS[build.insight],
          Math.max(1, Math.trunc(value) || 1),
        );
        get()._setActiveProfile({
          ...profile,
          characters: { ...profile.characters, [id]: { ...build, level } },
        });
      },
      setResonance: (id, value) => {
        const profile = active(get),
          build = profile.characters[id];
        if (!build) return;
        const resonance = Math.min(
          RESONANCE_MAX,
          Math.max(0, Math.trunc(value) || 0),
        );
        get()._setActiveProfile({
          ...profile,
          characters: { ...profile.characters, [id]: { ...build, resonance } },
        });
      },
      setPortray: (id, value) => {
        const profile = active(get),
          build = profile.characters[id];
        if (!build) return;
        const portray = Math.min(
          PORTRAY_MAX,
          Math.max(0, Math.trunc(value) || 0),
        );
        get()._setActiveProfile({
          ...profile,
          characters: { ...profile.characters, [id]: { ...build, portray } },
        });
      },
      setActiveVariant: (id, value) => {
        const profile = active(get),
          build = profile.characters[id],
          def = getCharacter(id);
        const selected =
          value === null ? null : def?.skins.find((skin) => skin.id === value);
        if (
          !build ||
          !def ||
          (value !== null && !selected) ||
          (selected?.released === false && !futureSelectionAllowed(get))
        )
          return;
        get()._setActiveProfile({
          ...profile,
          characters: {
            ...profile.characters,
            [id]: { ...build, activeVariant: value },
          },
        });
      },
      addPsychube: (id) => {
        const profile = active(get);
        const def = getPsychube(id);
        if (
          !def ||
          profile.psychubes[id] ||
          (!def.released && !futureSelectionAllowed(get))
        )
          return;
        get()._setActiveProfile({
          ...profile,
          psychubes: {
            ...profile.psychubes,
            [id]: get().preferences.psychubeImprintDefault,
          },
        });
      },
      setPsychubeImprint: (id, imprint) => {
        const profile = active(get);
        const def = getPsychube(id);
        if (
          !def ||
          (!profile.psychubes[id] &&
            !def.released &&
            !futureSelectionAllowed(get))
        )
          return;
        const clean = Math.min(
          PSYCHUBE_IMPRINT_MAX,
          Math.max(0, Math.trunc(imprint) || 0),
        );
        const psychubes = { ...profile.psychubes };
        if (clean > 0) psychubes[id] = clean;
        else delete psychubes[id];
        get()._setActiveProfile({ ...profile, psychubes });
      },
      removePsychube: (id) => {
        const profile = active(get),
          psychubes = { ...profile.psychubes };
        delete psychubes[id];
        const teams = profile.teams.map((team) => ({
          ...team,
          slots: team.slots.map((slot) => ({
            ...slot,
            psychubeId: slot.psychubeId === id ? null : slot.psychubeId,
            psychubeId2: slot.psychubeId2 === id ? null : slot.psychubeId2,
          })),
        }));
        get()._setActiveProfile({ ...profile, psychubes, teams });
      },
      assignSlot: (
        ti,
        si,
        characterId,
        psychubeId,
        requestedPsychubeId2 = null,
      ) => {
        const profile = active(get);
        if (ti < 0 || ti >= TEAM_COUNT || si < 0 || si >= SLOTS_PER_TEAM)
          return false;
        if (characterId !== null && !profile.characters[characterId])
          return false;
        const characterDef = characterId
          ? getCharacter(characterId)
          : undefined;
        if (characterId && !characterDef) return false;
        if (!characterId) {
          psychubeId = null;
          requestedPsychubeId2 = null;
        }
        let psychubes = profile.psychubes;
        const [pairedPrimary, pairedSecondary] =
          characterDef?.exclusivePsychubeIds ?? [];
        if (
          characterDef?.psychubeSlots === 2 &&
          psychubeId === pairedPrimary &&
          pairedSecondary
        ) {
          const pairedDef = getPsychube(pairedSecondary);
          if (
            !pairedDef ||
            (!pairedDef.released && !futureSelectionAllowed(get))
          )
            return false;
          requestedPsychubeId2 = pairedSecondary;
          if (!psychubes[pairedSecondary])
            psychubes = {
              ...psychubes,
              [pairedSecondary]: get().preferences.psychubeImprintDefault,
            };
        }
        const psychubeId2 =
          characterDef?.psychubeSlots === 2 ? requestedPsychubeId2 : null;
        const requestedPsychubes = [psychubeId, psychubeId2].filter(
          (id): id is string => id !== null,
        );
        if (requestedPsychubes.some((id) => !psychubes[id])) return false;
        const team = profile.teams[ti];
        const currentSlot = team.slots[si];
        if (characterId && characterId !== currentSlot.characterId) {
          if (
            !characterDef ||
            (!characterDef.released && !futureSelectionAllowed(get))
          )
            return false;
        }
        for (const id of requestedPsychubes) {
          const def = getPsychube(id);
          if (!def || (!def.released && !futureSelectionAllowed(get)))
            return false;
        }
        if (
          characterId &&
          team.slots.some(
            (slot, index) => index !== si && slot.characterId === characterId,
          )
        )
          return false;
        const teams = profile.teams.map((item, index) =>
          index === ti
            ? {
                ...item,
                slots: item.slots.map((slot, index2) =>
                  index2 === si
                    ? { characterId, psychubeId, psychubeId2 }
                    : { ...slot },
                ),
              }
            : item,
        );
        get()._setActiveProfile({ ...profile, psychubes, teams });
        return true;
      },
      setTeamName: (ti, name) => {
        const profile = active(get);
        if (ti < 0 || ti >= TEAM_COUNT) return;
        const teams = profile.teams.map((team, index) =>
          index === ti ? { ...team, name: normalizeTeamName(name) } : team,
        );
        get()._setActiveProfile({ ...profile, teams });
      },
      swapSlots: (ti, a, b) => {
        const profile = active(get);
        if (
          ti < 0 ||
          ti >= TEAM_COUNT ||
          a < 0 ||
          b < 0 ||
          a >= SLOTS_PER_TEAM ||
          b >= SLOTS_PER_TEAM ||
          a === b
        )
          return;
        const teams = profile.teams.map((team, index) => {
          if (index !== ti) return team;
          const slots = team.slots.map((slot) => ({ ...slot }));
          [slots[a], slots[b]] = [slots[b], slots[a]];
          return { ...team, slots };
        });
        get()._setActiveProfile({ ...profile, teams });
      },
      clearTeam: (ti) => {
        const profile = active(get);
        if (ti < 0 || ti >= TEAM_COUNT) return;
        const teams = profile.teams.map((team, index) =>
          index === ti
            ? {
                ...team,
                slots: team.slots.map(() => ({
                  characterId: null,
                  psychubeId: null,
                  psychubeId2: null,
                })),
              }
            : team,
        );
        get()._setActiveProfile({ ...profile, teams });
      },
      resetAll: () => get()._setActiveProfile(emptyProfile()),
      setTab: (tab) => set({ ui: { ...get().ui, tab } }),
      setSearch: (search) => set({ ui: { ...get().ui, search } }),
      setFilterMode: (filterMode) => set({ ui: { ...get().ui, filterMode } }),
      setRarityFilter: (rarityFilter) =>
        set({ ui: { ...get().ui, rarityFilter } }),
      setAssignment: (assignment) => set({ ui: { ...get().ui, assignment } }),
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
        const profile = active(get);
        const selectable = new Set(
          allPsychubes()
            .filter(
              (definition) =>
                definition.released || futureSelectionAllowed(get),
            )
            .map((definition) => definition.id),
        );
        const cleanImprint = Math.min(
          PSYCHUBE_IMPRINT_MAX,
          Math.max(1, Math.trunc(imprint) || 1),
        );
        const psychubes = { ...profile.psychubes };
        for (const id of selectable) {
          if (owned) psychubes[id] = cleanImprint;
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
        get()._setActiveProfile({ ...profile, psychubes, teams });
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
