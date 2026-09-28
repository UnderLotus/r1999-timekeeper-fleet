import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCatalogPolicy } from "./catalog-policy";
import { loadCnJSON } from "./sync-cn-data";
import { parseReleaseOrderSources, type ReleaseOrderSources } from "./recalculate-order";
import { withPipelineLock } from "./sync-lock";
import {
  fetchRemoteText,
  isUpstreamRefreshError,
  parseRemoteJson,
  upstreamResponseFailure,
  UpstreamRefreshError,
} from "./sync-refresh";
import type { ArcanistEntryFull } from "./skin-utils";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RELEASE_ORDER_FILE = path.join(__dirname, "data/release-order.json");
const HUJI_FETCHER = path.join(__dirname, "fetch-huiji-list.py");
const PYTHON = path.join(ROOT, ".venv/bin/python");
const KB_BASE = "https://raw.githubusercontent.com/windbow27/kornblume/main";

export interface HuijiCard {
  id: number;
  baseId: string;
  name: string;
  href: string;
}

export interface ReleaseOrderCharacter {
  id: number;
  name: string;
  nameEng?: string;
}

export interface KornblumeCharacter {
  Id: number;
  Name: string;
  Rarity: number;
}

export interface KornblumeData {
  names: Record<string, string>;
  characters: KornblumeCharacter[];
}

export type VariantOwnership = ReadonlyMap<string, string>;

/** Build the exact Variant-to-parent mapping from current ArcanistMap live2d data. */
export function buildVariantOwnershipMap(
  arcanists: readonly ArcanistEntryFull[],
): Map<string, string> {
  const ownership = new Map<string, string>();
  for (const arcanist of arcanists) {
    const baseId = String(arcanist.id);
    for (const variant of arcanist.live2d)
      ownership.set(String(variant.id), baseId);
  }
  return ownership;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${String(error)}`);
  }
}

/**
 * Parse the direct fetch helper output and keep the last Huiji card per
 * character. Current ArcanistMap ownership is authoritative; only unmapped
 * historical six-digit cards retain the legacy /100 fallback.
 */
export function parseHuijiCards(
  value: string,
  ownership: VariantOwnership = new Map(),
): HuijiCard[] {
  const raw = parseJson(value, "Huiji");
  if (!Array.isArray(raw)) throw new Error("Huiji response must be an array");
  const deduped = new Map<string, { sequence: number; card: HuijiCard }>();
  raw.forEach((item, sequence) => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      throw new Error(`Huiji card ${sequence} must be an object`);
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "number" ||
      !Number.isSafeInteger(row.id) ||
      row.id < 100 ||
      typeof row.name !== "string" ||
      typeof row.href !== "string" ||
      !row.href.startsWith("https://res1999.huijiwiki.com/wiki/")
    )
      throw new Error(`Huiji card ${sequence} has invalid ID, name, or URL`);
    const variantId = String(row.id);
    const mappedBaseId = ownership.get(variantId);
    const baseId = mappedBaseId ??
      (variantId.length === 6 ? String(Math.floor(row.id / 100)) : null);
    if (!baseId)
      throw new Error(`Huiji card ${sequence} Variant ${variantId} has no current ArcanistMap owner`);
    if (
      mappedBaseId === undefined &&
      row.baseId !== undefined &&
      row.baseId !== baseId
    )
      throw new Error(`Huiji card ${sequence} has inconsistent base ID`);
    deduped.set(baseId, {
      sequence,
      card: {
        id: row.id as number,
        baseId,
        name: row.name,
        href: row.href,
      },
    });
  });
  return [...deduped.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .map(({ card }) => card);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function createReleaseOrderSnapshot(
  knownCharacters: readonly ReleaseOrderCharacter[],
  freshCards: readonly HuijiCard[],
  previousHuiji: readonly string[],
  kornblume: KornblumeData,
): ReleaseOrderSources {
  const knownById = new Map(knownCharacters.map((entry) => [String(entry.id), entry]));
  const fresh: string[] = [];
  const freshSet = new Set<string>();
  for (const card of freshCards) {
    if (knownById.has(card.baseId) && !freshSet.has(card.baseId)) {
      fresh.push(card.baseId);
      freshSet.add(card.baseId);
    }
  }
  if (fresh.length < 100)
    throw new Error(`Huiji parser returned only ${fresh.length} known characters`);

  const legacy: string[] = [];
  const huijiSet = new Set(fresh);
  for (const id of previousHuiji) {
    if (knownById.has(id) && !huijiSet.has(id)) {
      legacy.push(id);
      huijiSet.add(id);
    }
  }
  const huiji = [...fresh, ...legacy];

  const metaBySlug = new Map(
    kornblume.characters.map((entry) => [slugify(entry.Name), entry]),
  );
  const slugByCn = new Map(
    Object.entries(kornblume.names).map(([slug, name]) => [name, slug]),
  );
  const kornblumeIds = knownCharacters
    .filter((entry) => !huijiSet.has(String(entry.id)))
    .flatMap((entry) => {
      const meta = metaBySlug.get(
        slugByCn.get(entry.name) ?? slugify(entry.nameEng ?? ""),
      );
      return meta
        ? [{ baseId: String(entry.id), rarity: meta.Rarity, id: meta.Id }]
        : [];
    })
    .sort((a, b) => b.rarity - a.rarity || a.id - b.id)
    .map((entry) => entry.baseId);

  const seen = new Set<string>();
  for (const id of [...huiji, ...kornblumeIds]) {
    if (seen.has(id)) throw new Error(`Duplicate release-order ID: ${id}`);
    seen.add(id);
  }
  return {
    source: "direct Huiji Chrome-fingerprint list; legacy Huiji tail; Kornblume fallback; CN-only newest tier",
    huiji,
    kornblume: kornblumeIds,
  };
}

function fetchText(url: string): string {
  return fetchRemoteText(url, 180, 20 * 1024 * 1024, 2);
}

function childExitCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function fetchHuiji(): string {
  if (!existsSync(PYTHON))
    throw new Error(
      `Huiji direct transport is unavailable: create .venv and install requirements-huiji.txt (${PYTHON})`,
    );
  try {
    return execFileSync(PYTHON, [HUJI_FETCHER], {
      cwd: ROOT,
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    // fetch-huiji-list.py reserves exit 3 for HTTP/challenge/coverage failures.
    // Missing dependencies and unhandled Python errors retain their fatal exits.
    if (childExitCode(error) === 3)
      throw new UpstreamRefreshError("Huiji remote acquisition failed", { cause: error });
    throw error;
  }
}

function fetchKornblume(): KornblumeData {
  const names = parseRemoteJson(
    fetchText(`${KB_BASE}/lang/static/arcanists/zh-CN.json`),
    "Kornblume names",
  );
  const characters = parseRemoteJson(
    fetchText(`${KB_BASE}/public/data/arcanists.json`),
    "Kornblume character metadata",
  );
  if (typeof names !== "object" || names === null || Array.isArray(names))
    throw upstreamResponseFailure("Kornblume Chinese names must be an object");
  if (
    Object.values(names).some((name) => typeof name !== "string") ||
    !Array.isArray(characters)
  )
    throw upstreamResponseFailure("Kornblume response failed shape validation");
  const parsedCharacters = characters.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw upstreamResponseFailure(`Kornblume character ${index} must be an object`);
    const row = entry as Record<string, unknown>;
    if (
      !Number.isSafeInteger(row.Id) ||
      typeof row.Name !== "string" ||
      typeof row.Rarity !== "number" ||
      !Number.isFinite(row.Rarity)
    )
      throw upstreamResponseFailure(`Kornblume character ${index} is invalid`);
    return { Id: row.Id as number, Name: row.Name, Rarity: row.Rarity };
  });
  if (Object.keys(names).length < 100 || parsedCharacters.length < 100)
    throw upstreamResponseFailure("Kornblume response failed coverage validation");
  return { names: names as Record<string, string>, characters: parsedCharacters };
}


function writeReleaseOrder(file: string, value: ReleaseOrderSources): void {
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export async function synchronizeReleaseOrderFile(
  file: string,
  knownCharacters: readonly ReleaseOrderCharacter[],
  acquireHuiji: () => Promise<string>,
  acquireKornblume: () => Promise<KornblumeData>,
  ownership: VariantOwnership = new Map(),
): Promise<ReleaseOrderSources> {
  // Local snapshot read/parse stays outside the remote warning boundary: a
  // corrupt or unreadable local source is fatal and must not be hidden.
  const previous = parseReleaseOrderSources(
    JSON.parse(readFileSync(file, "utf-8")) as unknown,
  );

  let cards: HuijiCard[];
  try {
    const raw = await acquireHuiji();
    try {
      cards = parseHuijiCards(raw, ownership);
    } catch (error) {
      throw upstreamResponseFailure("Huiji response failed JSON/card validation", error);
    }
    const knownIds = new Set(knownCharacters.map((entry) => String(entry.id)));
    const knownCardCount = cards.filter((entry) => knownIds.has(entry.baseId)).length;
    if (knownCardCount < 100)
      throw upstreamResponseFailure(
        `Huiji parser returned only ${knownCardCount} known characters`,
      );
  } catch (error) {
    if (!isUpstreamRefreshError(error)) throw error;
    console.warn(
      `sync:order warning — Huiji refresh failed; retaining release-order.json: ${error.message}`,
    );
    return previous;
  }

  let fallback: KornblumeData;
  try {
    fallback = await acquireKornblume();
  } catch (error) {
    if (!isUpstreamRefreshError(error)) throw error;
    console.warn(
      `sync:order warning — Kornblume refresh failed; retaining release-order.json: ${error.message}`,
    );
    return previous;
  }

  const snapshot = createReleaseOrderSnapshot(
    knownCharacters,
    cards,
    previous.huiji,
    fallback,
  );
  // Local writes remain fatal so callers can detect an incomplete refresh.
  writeReleaseOrder(file, snapshot);
  return snapshot;
}


async function main(): Promise<void> {
  console.log("sync:order — direct Huiji; legacy, Kornblume and CN fallback tiers\n");
  const policy = loadCatalogPolicy(path.join(__dirname, "data/catalog-policy.json"));
  const excluded = new Set(policy.excludedCharacters.map((entry) => entry.baseId));
  const cnCharacters = loadCnJSON<ReleaseOrderCharacter[]>("character.json");
  const cnById = new Map(cnCharacters.map((entry) => [String(entry.id), entry]));
  const arcanists = loadCnJSON<Array<ArcanistEntryFull>>("ArcanistMap.json");
  const known = arcanists.flatMap((entry) => {
    const metadata = cnById.get(String(entry.id));
    return metadata && !entry.name.includes("???") && !excluded.has(String(entry.id))
      ? [{ ...metadata, name: entry.name, nameEng: entry.nameEng ?? metadata.nameEng }]
      : [];
  });
  const snapshot = await synchronizeReleaseOrderFile(
    RELEASE_ORDER_FILE,
    known,
    async () => fetchHuiji(),
    async () => fetchKornblume(),
    buildVariantOwnershipMap(arcanists),
  );
  const knownIds = new Set(known.map((entry) => String(entry.id)));
  console.log(
    `Huiji fresh + legacy: ${snapshot.huiji.length}; Kornblume fallback: ${snapshot.kornblume.length}; CN-only newest: ${knownIds.size - snapshot.huiji.length - snapshot.kornblume.length}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void withPipelineLock(main).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
