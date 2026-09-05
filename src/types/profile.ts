import type { InsightIndex } from "./catalog";

export type DefaultSkinMode = "initial" | "insight";

/** 角色培養狀態（LOC-38：skin 是角色級狀態，非隊級） */
export interface CharacterBuild {
  insight: InsightIndex;
  level: number;
  /** 0-5 */
  portray: number;
  /** 0-RESONANCE_MAX */
  resonance: number;
  /** null = 用 catalog 預設 variant */
  activeVariant: string | null;
}

/** 隊 slot：只存引用，Pool 才是 source of truth（LOC-38） */
export interface TeamSlot {
  characterId: string | null;
  psychubeId: string | null;
  /** 支援具備第二心相欄的角色；一般角色固定為 null。 */
  psychubeId2: string | null;
}

export interface Team {
  name: string;
  slots: TeamSlot[];
}

export interface Profile {
  characters: Record<string, CharacterBuild>;
  /** key presence = 持有；value = 增幅 1–5。 */
  psychubes: Record<string, number>;
  /** 恰 4 隊 */
  teams: Team[];
}

export const TEAM_COUNT = 4;
export const TEAM_NAME_MAX_LENGTH = 12;
export const SLOTS_PER_TEAM = 4;

export const LEVEL_CAPS: Record<InsightIndex, number> = {
  0: 30,
  1: 40,
  2: 50,
  3: 60,
};
export const RESONANCE_MAX = 15;
export const PORTRAY_MAX = 5;
export const PSYCHUBE_IMPRINT_MAX = 5;

export function normalizeTeamName(value: unknown): string {
  if (typeof value !== "string") return "";
  return Array.from(value.trim()).slice(0, TEAM_NAME_MAX_LENGTH).join("");
}

export function emptyProfile(): Profile {
  return {
    characters: {},
    psychubes: {},
    teams: Array.from({ length: TEAM_COUNT }, () => ({
      name: "",
      slots: Array.from({ length: SLOTS_PER_TEAM }, () => ({
        characterId: null,
        psychubeId: null,
        psychubeId2: null,
      })),
    })),
  };
}
