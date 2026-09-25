import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadCatalogPolicy } from "./catalog-policy";
import { loadCnJSON } from "./sync-cn-data";
import { parseReleaseOrderSources, type ReleaseOrderSources } from "./recalculate-order";
import { withPipelineLock } from "./sync-lock";

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

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${String(error)}`);
  }
}

/** Parse the direct fetch helper output and keep the last Huiji card per character. */
export function parseHuijiCards(value: string): HuijiCard[] {
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
    const baseId = String(Math.floor(row.id / 100));
    if (row.baseId !== undefined && row.baseId !== baseId)
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
  return execFileSync("curl", ["-fsSL", "-m", "180", "--retry", "2", url], {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function fetchHuiji(): string {
  if (!existsSync(PYTHON))
    throw new Error(
      `Huiji direct transport is unavailable: create .venv and install requirements-huiji.txt (${PYTHON})`,
    );
  return execFileSync(PYTHON, [HUJI_FETCHER], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function fetchKornblume(): KornblumeData {
  const names = parseJson(
    fetchText(`${KB_BASE}/lang/static/arcanists/zh-CN.json`),
    "Kornblume names",
  );
  const characters = parseJson(
    fetchText(`${KB_BASE}/public/data/arcanists.json`),
    "Kornblume character metadata",
  );
  if (typeof names !== "object" || names === null || Array.isArray(names))
    throw new Error("Kornblume Chinese names must be an object");
  if (
    Object.values(names).some((name) => typeof name !== "string") ||
    !Array.isArray(characters)
  )
    throw new Error("Kornblume response failed shape validation");
  const parsedCharacters = characters.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw new Error(`Kornblume character ${index} must be an object`);
    const row = entry as Record<string, unknown>;
    if (
      !Number.isSafeInteger(row.Id) ||
      typeof row.Name !== "string" ||
      typeof row.Rarity !== "number" ||
      !Number.isFinite(row.Rarity)
    )
      throw new Error(`Kornblume character ${index} is invalid`);
    return { Id: row.Id as number, Name: row.Name, Rarity: row.Rarity };
  });
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
): Promise<ReleaseOrderSources> {
  const previous = parseReleaseOrderSources(
    JSON.parse(readFileSync(file, "utf-8")) as unknown,
  );
  const cards = parseHuijiCards(await acquireHuiji());
  const knownIds = new Set(knownCharacters.map((entry) => String(entry.id)));
  const knownCardCount = cards.filter((entry) => knownIds.has(entry.baseId)).length;
  if (knownCardCount < 100)
    throw new Error(`Huiji parser returned only ${knownCardCount} known characters`);
  const fallback = await acquireKornblume();
  const snapshot = createReleaseOrderSnapshot(
    knownCharacters,
    cards,
    previous.huiji,
    fallback,
  );
  writeReleaseOrder(file, snapshot);
  return snapshot;
}

async function main(): Promise<void> {
  console.log("sync:order — direct Huiji; legacy, Kornblume and CN fallback tiers\n");
  const policy = loadCatalogPolicy(path.join(__dirname, "data/catalog-policy.json"));
  const excluded = new Set(policy.excludedCharacters.map((entry) => entry.baseId));
  const cnCharacters = loadCnJSON<ReleaseOrderCharacter[]>("character.json");
  const cnById = new Map(cnCharacters.map((entry) => [entry.id, entry]));
  const known = loadCnJSON<Array<ReleaseOrderCharacter & { name: string }>>("ArcanistMap.json")
    .flatMap((entry) => {
      const metadata = cnById.get(entry.id);
      return metadata && !entry.name.includes("???") && !excluded.has(String(entry.id))
        ? [{ ...metadata, name: entry.name, nameEng: entry.nameEng ?? metadata.nameEng }]
        : [];
    });
  const snapshot = await synchronizeReleaseOrderFile(
    RELEASE_ORDER_FILE,
    known,
    async () => fetchHuiji(),
    async () => fetchKornblume(),
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
