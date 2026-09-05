import type { CharacterDef, PsychubeDef } from "../types/catalog";
import type { CharacterBuild, DefaultSkinMode, Profile } from "../types/profile";
import {
  allCharacters,
  allPsychubes,
  psychubesByRarityAndRecency,
  searchableNames,
} from "./catalog";

export type PoolTab = "characters" | "psychubes";
export type FilterMode = "all" | "owned" | "unowned";
export type PsychubeOwnershipMode = "unowned" | "owned";

export interface Assignment {
  team: number;
  slot: number;
  kind: "character" | "psychube";
  psychubeIndex?: 0 | 1;
}

/** UI state and transitions that are specific to the Pool, not the profile store. */
export interface PoolUiState {
  tab: PoolTab;
  search: string;
  filterMode: FilterMode;
  rarityFilter: number[];
  assignment: Assignment | null;
  assignmentPreviousFilter: FilterMode | null;
}

export function createPoolUiState(): PoolUiState {
  return {
    tab: "characters",
    search: "",
    filterMode: "all",
    rarityFilter: [],
    assignment: null,
    assignmentPreviousFilter: null,
  };
}

/**
 * Applies the Pool assignment transition without requiring Zustand. Starting an
 * assignment captures the user's filter once; ending it restores that exact
 * filter even if the user changes filters while choosing an entry.
 */
export function transitionPoolAssignment(
  state: PoolUiState,
  assignment: Assignment | null,
): PoolUiState {
  if (assignment === null) {
    if (!state.assignment)
      return { ...state, assignment: null, assignmentPreviousFilter: null };
    return {
      ...state,
      assignment: null,
      filterMode: state.assignmentPreviousFilter ?? state.filterMode,
      assignmentPreviousFilter: null,
    };
  }
  return {
    ...state,
    assignment,
    tab: assignment.kind === "character" ? "characters" : "psychubes",
    filterMode: "owned",
    assignmentPreviousFilter:
      state.assignment === null
        ? state.filterMode
        : state.assignmentPreviousFilter,
  };
}

export const CHARACTER_POOL_RARITIES = [2, 3, 4, 5, 6] as const;
export const PSYCHUBE_POOL_RARITIES = [3, 4, 5, 6] as const;

export function poolRarityOptions(tab: PoolTab): readonly number[] {
  return tab === "psychubes"
    ? PSYCHUBE_POOL_RARITIES
    : CHARACTER_POOL_RARITIES;
}

/** Psychube filters intentionally ignore a retained character-only 2★ value. */
export function normalizeRarityFilter(
  tab: PoolTab,
  rarityFilter: readonly number[],
): number[] {
  const options = poolRarityOptions(tab);
  return rarityFilter.filter((rarity) => options.includes(rarity));
}

export interface CharacterPoolEntry {
  definition: CharacterDef;
  build: CharacterBuild | undefined;
  owned: boolean;
}

export interface PsychubePoolEntry {
  definition: PsychubeDef;
  amplification: number;
  owned: boolean;
}

export interface PsychubeOwnershipSummary {
  visibleCount: number;
  ownedCount: number;
  status: PsychubeOwnershipMode | null;
}

export interface PoolView {
  tab: PoolTab;
  rarityOptions: readonly number[];
  visibleRarityFilter: readonly number[];
  characters: readonly CharacterPoolEntry[];
  psychubes: readonly PsychubePoolEntry[];
  psychubeOwnership: PsychubeOwnershipSummary;
}

export interface PoolViewInput {
  profile: Profile;
  tab: PoolTab;
  search: string;
  filterMode: FilterMode;
  rarityFilter: readonly number[];
  revealFuture: boolean;
}

function matchesRarity(
  rarity: number | null,
  normalizedFilter: readonly number[],
): boolean {
  return (
    normalizedFilter.length === 0 ||
    rarity === null ||
    normalizedFilter.includes(rarity + 1)
  );
}

function matchesOwnership(owned: boolean, filterMode: FilterMode): boolean {
  return (
    filterMode === "all" ||
    (filterMode === "owned" && owned) ||
    (filterMode === "unowned" && !owned)
  );
}

function matchesSearch(
  names: Record<"zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR", string>,
  query: string,
): boolean {
  return !query || searchableNames(names).includes(query);
}

export function summarizePsychubeOwnership(
  profile: Profile,
  revealFuture: boolean,
): PsychubeOwnershipSummary {
  const visible = allPsychubes().filter(
    (definition) => definition.released || revealFuture,
  );
  const ownedCount = visible.filter((definition) =>
    Boolean(profile.psychubes[definition.id]),
  ).length;
  return {
    visibleCount: visible.length,
    ownedCount,
    status:
      ownedCount === 0
        ? "unowned"
        : ownedCount === visible.length
          ? "owned"
          : null,
  };
}

/**
 * Returns normalized Pool entries. Catalog order and Future Sight visibility are
 * resolved here so rendering code only maps entries to cards.
 */
export function createPoolView(input: PoolViewInput): PoolView {
  const query = input.search.trim().toLocaleLowerCase();
  const visibleRarityFilter = normalizeRarityFilter(
    input.tab,
    input.rarityFilter,
  );
  const characters: CharacterPoolEntry[] =
    input.tab === "characters"
      ? allCharacters()
          .filter((definition) => definition.released || input.revealFuture)
          .filter((definition) => {
            const owned = Boolean(input.profile.characters[definition.id]);
            const rarity =
              definition.rarity === null ? null : definition.rarity;
            return (
              matchesOwnership(owned, input.filterMode) &&
              matchesRarity(rarity, visibleRarityFilter) &&
              matchesSearch(definition.names, query)
            );
          })
          .map((definition) => ({
            definition,
            build: input.profile.characters[definition.id],
            owned: Boolean(input.profile.characters[definition.id]),
          }))
      : [];
  const psychubes: PsychubePoolEntry[] =
    input.tab === "psychubes"
      ? psychubesByRarityAndRecency()
          .filter((definition) => definition.released || input.revealFuture)
          .filter((definition) => {
            const amplification = input.profile.psychubes[definition.id] ?? 0;
            return (
              matchesOwnership(amplification > 0, input.filterMode) &&
              matchesRarity(definition.rarity, visibleRarityFilter) &&
              matchesSearch(definition.names, query)
            );
          })
          .map((definition) => {
            const amplification = input.profile.psychubes[definition.id] ?? 0;
            return { definition, amplification, owned: amplification > 0 };
          })
      : [];
  return {
    tab: input.tab,
    rarityOptions: poolRarityOptions(input.tab),
    visibleRarityFilter,
    characters,
    psychubes,
    psychubeOwnership: summarizePsychubeOwnership(
      input.profile,
      input.revealFuture,
    ),
  };
}

export type AddDefaults = Omit<CharacterBuild, "activeVariant">;

export interface PoolDefaultsDraft {
  addDefaults: AddDefaults;
  defaultSkinMode: DefaultSkinMode;
  psychubeAmplificationDefault: number;
  psychubeOwnershipStatus: PsychubeOwnershipMode | null;
}
