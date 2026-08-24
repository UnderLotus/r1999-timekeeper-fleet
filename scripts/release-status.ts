import { existsSync, readFileSync } from "node:fs";

export interface CharacterReleaseOverride {
  baseId: number;
  isReleased: boolean;
  note?: string;
}

export interface SkinReleaseOverride {
  variantId: string;
  isReleased: boolean;
  note?: string;
}

export interface PsychubeReleaseOverride {
  id: string;
  isReleased: boolean;
  note?: string;
}

export interface ReleaseOverrides {
  characters: CharacterReleaseOverride[];
  skins: SkinReleaseOverride[];
  psychubes: PsychubeReleaseOverride[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNote(entry: Record<string, unknown>): { note?: string } {
  return entry.note === undefined ? {} : { note: entry.note as string };
}

export function parseReleaseOverrides(value: unknown): ReleaseOverrides {
  if (
    !isRecord(value) ||
    !Array.isArray(value.characters) ||
    !Array.isArray(value.skins) ||
    !Array.isArray(value.psychubes)
  ) {
    throw new Error(
      "released-overrides.json must contain characters[], skins[], and psychubes[]",
    );
  }
  const characters = value.characters.map((raw, index) => {
    if (
      !isRecord(raw) ||
      !Number.isInteger(raw.baseId) ||
      typeof raw.isReleased !== "boolean" ||
      (raw.note !== undefined && typeof raw.note !== "string")
    )
      throw new Error(`Invalid character release override at index ${index}`);
    return {
      baseId: raw.baseId as number,
      isReleased: raw.isReleased,
      ...optionalNote(raw),
    };
  });
  const skins = value.skins.map((raw, index) => {
    if (
      !isRecord(raw) ||
      typeof raw.variantId !== "string" ||
      !/^\d+$/.test(raw.variantId) ||
      typeof raw.isReleased !== "boolean" ||
      (raw.note !== undefined && typeof raw.note !== "string")
    )
      throw new Error(`Invalid skin release override at index ${index}`);
    return {
      variantId: raw.variantId,
      isReleased: raw.isReleased,
      ...optionalNote(raw),
    };
  });
  const psychubes = value.psychubes.map((raw, index) => {
    if (
      !isRecord(raw) ||
      typeof raw.id !== "string" ||
      !/^\d+$/.test(raw.id) ||
      typeof raw.isReleased !== "boolean" ||
      (raw.note !== undefined && typeof raw.note !== "string")
    )
      throw new Error(`Invalid psychube release override at index ${index}`);
    return {
      id: raw.id,
      isReleased: raw.isReleased,
      ...optionalNote(raw),
    };
  });
  return { characters, skins, psychubes };
}

export function loadReleaseOverrides(file: string): ReleaseOverrides {
  if (!existsSync(file)) return { characters: [], skins: [], psychubes: [] };
  return parseReleaseOverrides(JSON.parse(readFileSync(file, "utf-8")));
}

export function uniqueOverrides<T, K>(
  values: readonly T[],
  keyFor: (value: T) => K,
  label: string,
): Map<K, T> {
  const result = new Map<K, T>();
  for (const value of values) {
    const key = keyFor(value);
    if (result.has(key)) throw new Error(`Duplicate ${label}: ${String(key)}`);
    result.set(key, value);
  }
  return result;
}

export function assertKnownOverrides<K>(
  overrides: ReadonlyMap<K, unknown>,
  known: ReadonlySet<K>,
  label: string,
): void {
  for (const id of overrides.keys()) {
    if (!known.has(id))
      throw new Error(`${label} references unknown ID: ${String(id)}`);
  }
}

export interface KnownReleaseIds {
  characters: ReadonlySet<string>;
  skins: ReadonlySet<string>;
  psychubes: ReadonlySet<string>;
}
export interface ReleaseOverrideIndex {
  characters: Map<string, CharacterReleaseOverride>;
  skins: Map<string, SkinReleaseOverride>;
  psychubes: Map<string, PsychubeReleaseOverride>;
}
export function indexReleaseOverrides(
  overrides: ReleaseOverrides,
  known: KnownReleaseIds,
): ReleaseOverrideIndex {
  const characters = uniqueOverrides(
    overrides.characters,
    (entry) => String(entry.baseId),
    "character override baseId",
  );
  const skins = uniqueOverrides(
    overrides.skins,
    (entry) => entry.variantId,
    "skin override variantId",
  );
  const psychubes = uniqueOverrides(
    overrides.psychubes,
    (entry) => entry.id,
    "psychube override id",
  );
  assertKnownOverrides(characters, known.characters, "Character override");
  assertKnownOverrides(skins, known.skins, "Skin override");
  assertKnownOverrides(psychubes, known.psychubes, "Psychube override");
  return { characters, skins, psychubes };
}

export function resolveGlobalIsOnline(value: unknown): boolean {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === "0" ||
    value === 0
  )
    return false;
  if (value === "1" || value === 1) return true;
  throw new Error(`Unknown Global character isOnline value: ${String(value)}`);
}
export function resolveCharacterRelease(
  glReleased: boolean,
  manual?: boolean,
): boolean {
  return manual ?? glReleased;
}
/** Only optional garments use GL skin.json presence; default/insight variants stay available. */
export function resolveSkinRelease(
  type: "default" | "insight" | "skin",
  glPresent: boolean | undefined,
  manual?: boolean,
): boolean {
  if (type !== "skin") return true;
  if (typeof glPresent !== "boolean")
    throw new Error("Garment release requires Global skin.json presence");
  return manual ?? glPresent;
}
export function resolvePsychubeRelease(
  glPresent: boolean,
  manual?: boolean,
): boolean {
  return manual ?? glPresent;
}
