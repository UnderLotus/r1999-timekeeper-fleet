/**
 * Exact-ID locale name supplement for already-catalogued characters and
 * psychubes. A names row never creates or removes a catalog entity; each region
 * keeps its last known good names when its upstream page cannot be read.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NAME_LANGS, type PartialNames } from "./name-fallbacks";
import { fetchRemoteText, isUpstreamRefreshError } from "./sync-refresh";
import {
  parseUttuProfileNames,
  parseUttuPsychubeNames,
  UTTU_PROFILES_URL,
  UTTU_PSYCHUBES_URL,
  UttuParseError,
  type UttuNameRow,
} from "./uttu-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const UTTU_NAMES_SCHEMA_VERSION = 1;
export const UTTU_NAMES_FILE = path.join(__dirname, "data/uttu-names.json");

export interface UttuNamesSnapshot {
  schemaVersion: typeof UTTU_NAMES_SCHEMA_VERSION;
  characters: UttuNameRow[];
  psychubes: UttuNameRow[];
}

export interface UttuNamesRefresh {
  warnings: string[];
  characters: number;
  psychubes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRows(value: unknown, label: string): UttuNameRow[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !/^\d+$/.test(entry.id)
    )
      throw new Error(`${label} row ${index} has an invalid id`);
    if (seen.has(entry.id))
      throw new Error(`${label} has duplicate id ${entry.id}`);
    seen.add(entry.id);
    if (!isRecord(entry.names) || Object.keys(entry.names).length === 0)
      throw new Error(`${label} row ${entry.id} has no names`);
    const names: PartialNames = {};
    for (const lang of NAME_LANGS) {
      const name = entry.names[lang];
      if (name === undefined) continue;
      if (typeof name !== "string" || !name.trim())
        throw new Error(`${label} row ${entry.id} has an invalid ${lang} name`);
      names[lang] = name.trim();
    }
    if (Object.keys(names).length === 0)
      throw new Error(`${label} row ${entry.id} has no names`);
    return { id: entry.id, names };
  });
}

export function parseUttuNames(value: unknown): UttuNamesSnapshot {
  if (!isRecord(value)) throw new Error("uttu-names.json must be an object");
  if (value.schemaVersion !== UTTU_NAMES_SCHEMA_VERSION)
    throw new Error("Unsupported uttu-names.json schemaVersion");
  return {
    schemaVersion: UTTU_NAMES_SCHEMA_VERSION,
    characters: readRows(value.characters, "characters"),
    psychubes: readRows(value.psychubes, "psychubes"),
  };
}

export function emptyUttuNames(): UttuNamesSnapshot {
  return {
    schemaVersion: UTTU_NAMES_SCHEMA_VERSION,
    characters: [],
    psychubes: [],
  };
}

/** A corrupt local snapshot is a local failure; it must never fall back silently. */
export function loadUttuNames(file: string = UTTU_NAMES_FILE): UttuNamesSnapshot {
  if (!existsSync(file)) return emptyUttuNames();
  return parseUttuNames(JSON.parse(readFileSync(file, "utf-8")) as unknown);
}

function orderedNames(names: PartialNames): PartialNames {
  return Object.fromEntries(
    NAME_LANGS.flatMap((lang) => (names[lang] ? [[lang, names[lang]]] : [])),
  ) as PartialNames;
}

function orderedRows(rows: readonly UttuNameRow[]): UttuNameRow[] {
  return [...rows]
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map((row) => ({ id: row.id, names: orderedNames(row.names) }));
}

/** Same input always serializes to the same bytes: stable order, no timestamp. */
export function saveUttuNames(file: string, snapshot: UttuNamesSnapshot): void {
  const serialized =
    JSON.stringify(
      {
        schemaVersion: UTTU_NAMES_SCHEMA_VERSION,
        characters: orderedRows(snapshot.characters),
        psychubes: orderedRows(snapshot.psychubes),
      },
      null,
      2,
    ) + "\n";
  mkdirSync(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryFile, serialized);
    renameSync(temporaryFile, file);
  } catch (error) {
    rmSync(temporaryFile, { force: true });
    throw error;
  }
}

/**
 * Per-locale last known good: a missing, empty or N/A locale never clears a
 * stored name, and a row that disappears upstream keeps its previous names.
 */
function mergeRegion(
  previous: readonly UttuNameRow[],
  incoming: readonly UttuNameRow[] | null,
): UttuNameRow[] {
  if (!incoming) return [...previous];
  const byId = new Map(previous.map((row) => [row.id, row.names]));
  for (const row of incoming) byId.set(row.id, { ...byId.get(row.id), ...row.names });
  return [...byId].map(([id, names]) => ({ id, names }));
}

export function mergeUttuNames(
  previous: UttuNamesSnapshot,
  incoming: {
    characters: UttuNameRow[] | null;
    psychubes: UttuNameRow[] | null;
  },
): UttuNamesSnapshot {
  return {
    schemaVersion: UTTU_NAMES_SCHEMA_VERSION,
    characters: mergeRegion(previous.characters, incoming.characters),
    psychubes: mergeRegion(previous.psychubes, incoming.psychubes),
  };
}

export function indexUttuNames(
  rows: readonly UttuNameRow[],
): Map<string, PartialNames> {
  return new Map(rows.map((row) => [row.id, row.names]));
}

function readRegion(
  read: () => string,
  parse: (html: string) => UttuNameRow[],
  label: string,
): { rows: UttuNameRow[] | null; warning: string | null } {
  try {
    return { rows: parse(read()), warning: null };
  } catch (error) {
    if (!(error instanceof UttuParseError) && !isUpstreamRefreshError(error))
      throw error;
    return {
      rows: null,
      warning: `UTTU ${label} names refresh failed; keeping the previous ${label} names: ${error.message}`,
    };
  }
}

/**
 * Refresh both name regions independently, so a broken profiles page still lets
 * the psychube names update and each region falls back to its own LKG. Local
 * snapshot read/write failures are not remote outages and always throw.
 */
export function refreshUttuNames(
  fetchPages: { profiles: () => string; psychubes: () => string } = {
    profiles: () => fetchRemoteText(UTTU_PROFILES_URL, 60, 4 * 1024 * 1024),
    psychubes: () => fetchRemoteText(UTTU_PSYCHUBES_URL, 60, 8 * 1024 * 1024),
  },
  file: string = UTTU_NAMES_FILE,
): UttuNamesRefresh {
  const previous = loadUttuNames(file);
  const characters = readRegion(fetchPages.profiles, parseUttuProfileNames, "character");
  const psychubes = readRegion(fetchPages.psychubes, parseUttuPsychubeNames, "psychube");
  const snapshot = mergeUttuNames(previous, {
    characters: characters.rows,
    psychubes: psychubes.rows,
  });
  saveUttuNames(file, snapshot);
  return {
    warnings: [characters.warning, psychubes.warning].filter(
      (warning): warning is string => warning !== null,
    ),
    characters: snapshot.characters.length,
    psychubes: snapshot.psychubes.length,
  };
}
