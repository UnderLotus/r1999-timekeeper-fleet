import type { CharacterDef, InsightIndex } from "../types/catalog";
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
import {
  profileMutationCatalog,
  type ProfileMutationCatalog,
} from "./catalog";

export const ADD_DEFAULT: Omit<CharacterBuild, "activeVariant"> = {
  insight: 0,
  level: 1,
  portray: 0,
  resonance: 1,
};
function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function normalizeLegalInsight(
  def: CharacterDef,
  value: unknown,
  catalog: Pick<ProfileMutationCatalog, "legalInsights">,
): InsightIndex | null {
  const requested = Math.max(
    0,
    Math.trunc(finite(value, ADD_DEFAULT.insight)),
  );
  const legal = catalog.legalInsights(def);
  if (legal.length === 0) return null;
  const atOrBelow = legal.filter((insight) => insight <= requested);
  return (atOrBelow.length > 0
    ? Math.max(...atOrBelow)
    : Math.min(...legal)) as InsightIndex;
}
function sanitizeBuild(
  id: string,
  value: unknown,
  catalog: Pick<ProfileMutationCatalog, "getCharacter" | "legalInsights">,
): CharacterBuild | null {
  const def = catalog.getCharacter(id);
  if (!def || !record(value)) return null;
  const insight = normalizeLegalInsight(def, value.insight, catalog);
  if (insight === null) return null;
  const requested =
    typeof value.activeVariant === "string" ? value.activeVariant : null;
  return {
    insight,
    level: Math.min(
      LEVEL_CAPS[insight],
      Math.max(1, Math.trunc(finite(value.level, ADD_DEFAULT.level))),
    ),
    portray: Math.min(
      PORTRAY_MAX,
      Math.max(0, Math.trunc(finite(value.portray, ADD_DEFAULT.portray))),
    ),
    resonance: Math.min(
      RESONANCE_MAX,
      Math.max(0, Math.trunc(finite(value.resonance, ADD_DEFAULT.resonance))),
    ),
    activeVariant:
      requested && def.skins.some((skin) => skin.id === requested)
        ? requested
        : null,
  };
}
export function sanitizeProfile(
  value: unknown,
  catalog: Pick<
    ProfileMutationCatalog,
    "getCharacter" | "getPsychube" | "legalInsights"
  > = profileMutationCatalog,
): Profile {
  const out = emptyProfile();
  if (!record(value)) return out;
  if (record(value.characters))
    for (const [id, build] of Object.entries(value.characters)) {
      const clean = sanitizeBuild(id, build, catalog);
      if (clean) out.characters[id] = clean;
    }
  if (record(value.psychubes))
    for (const [id, imprint] of Object.entries(value.psychubes)) {
      if (!catalog.getPsychube(id)) continue;
      const clean = Math.min(
        PSYCHUBE_IMPRINT_MAX,
        Math.max(0, Math.trunc(finite(imprint, 0))),
      );
      if (clean > 0) out.psychubes[id] = clean;
    }
  const teams = Array.isArray(value.teams) ? value.teams : [];
  for (let teamIndex = 0; teamIndex < TEAM_COUNT; teamIndex++) {
    const rawTeamRecord = record(teams[teamIndex]) ? teams[teamIndex] : {};
    const rawTeam = Array.isArray(rawTeamRecord.slots)
      ? rawTeamRecord.slots
      : [];
    out.teams[teamIndex].name = normalizeTeamName(rawTeamRecord.name);
    const characters = new Set<string>();
    for (let slotIndex = 0; slotIndex < SLOTS_PER_TEAM; slotIndex++) {
      const raw = record(rawTeam[slotIndex]) ? rawTeam[slotIndex] : {};
      let characterId =
        typeof raw.characterId === "string" && out.characters[raw.characterId]
          ? raw.characterId
          : null;
      if (characterId && characters.has(characterId)) characterId = null;
      if (characterId) characters.add(characterId);
      const allowedSlots = characterId
        ? (catalog.getCharacter(characterId)?.psychubeSlots ?? 1)
        : 0;
      const equipped: Array<string | null> = [null, null];
      for (let index = 0; index < allowedSlots; index++) {
        const id = [raw.psychubeId, raw.psychubeId2][index];
        if (typeof id === "string" && out.psychubes[id]) equipped[index] = id;
      }
      out.teams[teamIndex].slots[slotIndex] = {
        characterId,
        psychubeId: equipped[0],
        psychubeId2: equipped[1],
      };
    }
  }
  return out;
}
