import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import type { NameLang, PartialNames } from "./name-fallbacks";
import type { SourcePsychube } from "./catalog-source";
import { fetchRemoteFile, isUpstreamRefreshError } from "./sync-refresh";
import { uttuEquipIconUrl, type FetchBinary } from "./uttu-images";
import { decodeLosslessWebpToPng } from "./webp-converter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PSYCHUBE_IMAGE_CACHE_DIR = path.join(
  __dirname,
  "data/psychube-image-cache",
);
export const PSYCHUBE_IMAGE_INVENTORY_FILE = path.join(
  __dirname,
  "data/psychube-image-inventory.json",
);

export interface PsychubeImageRecord {
  assetPath: string;
  sha256: string;
  /** Set when the PNG was decoded from the UTTU supplemental mirror. */
  source?: string;
}

export interface PsychubeImageInventory {
  schemaVersion: 1;
  images: Record<string, PsychubeImageRecord>;
}

const LANGS: readonly NameLang[] = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja-JP",
  "ko-KR",
];

export function isTrustedPsychubeName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const name = value.trim();
  return (
    name.length > 0 &&
    !/^\?{2,}$/.test(name) &&
    !new Set(["unknown", "just test", "n/a"]).has(name.toLowerCase())
  );
}

/** Incoming psychube carrying only the names its raw sources resolved. */
export type PsychubeSourceCandidate = Omit<SourcePsychube, "names"> & {
  names: PartialNames;
};

function preferredEnglish(names: PartialNames): string | undefined {
  const english = names["en-US"]?.trim();
  const chinese = names["zh-CN"]?.trim();
  return isTrustedPsychubeName(english) && english !== chinese
    ? english
    : undefined;
}

function mergeSource(
  previous: SourcePsychube | undefined,
  incoming: PsychubeSourceCandidate,
): SourcePsychube {
  const names = {} as SourcePsychube["names"];
  const incomingZh = incoming.names["zh-CN"]?.trim();
  const zh = isTrustedPsychubeName(incomingZh)
    ? incomingZh
    : previous?.names["zh-CN"] ?? "";
  const english =
    preferredEnglish(incoming.names) ??
    (previous ? preferredEnglish(previous.names) : undefined) ??
    (isTrustedPsychubeName(incoming.names["en-US"])
      ? incoming.names["en-US"].trim()
      : zh);
  for (const lang of LANGS) {
    if (lang === "zh-CN") names[lang] = zh;
    else if (lang === "en-US") names[lang] = english;
    else {
      // A locale the raw sources resolved is trusted even when it repeats
      // English/CN; only a missing locale falls back to the previous row.
      const candidate = incoming.names[lang]?.trim();
      const previousTranslation = previous?.names[lang]?.trim();
      names[lang] = isTrustedPsychubeName(candidate)
        ? candidate
        : isTrustedPsychubeName(previousTranslation)
          ? previousTranslation
          : english;
    }
  }
  return {
    id: incoming.id,
    names,
    rarity:
      typeof incoming.rarity === "number" && Number.isFinite(incoming.rarity)
        ? incoming.rarity
        : (previous?.rarity ?? null),
    glPresent: incoming.glPresent,
  };
}

/** Merge incoming records while retaining trusted fields through absence or partial deterioration. */
export function mergePsychubeSourceRecords(
  previous: readonly SourcePsychube[],
  incoming: readonly PsychubeSourceCandidate[],
): SourcePsychube[] {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  const incomingIds = new Set(incoming.map((entry) => entry.id));
  const merged = incoming.map((entry) =>
    mergeSource(previousById.get(entry.id), entry),
  );
  for (const entry of previous)
    if (!incomingIds.has(entry.id)) merged.push(entry);
  return merged;
}

export function effectivePsychubes(
  source: readonly SourcePsychube[],
  imageIds: ReadonlySet<string>,
): SourcePsychube[] {
  return source.filter(
    (entry) =>
      /^\d+$/.test(entry.id) &&
      isTrustedPsychubeName(entry.names["zh-CN"]) &&
      imageIds.has(entry.id),
  );
}

export function emptyPsychubeImageInventory(): PsychubeImageInventory {
  return { schemaVersion: 1, images: {} };
}

export function parsePsychubeImageInventory(
  value: unknown,
): PsychubeImageInventory {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("psychube-image-inventory.json must be an object");
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== 1 ||
    typeof raw.images !== "object" ||
    raw.images === null ||
    Array.isArray(raw.images)
  )
    throw new Error("Invalid psychube-image-inventory.json schema");
  const images: Record<string, PsychubeImageRecord> = {};
  for (const [id, entry] of Object.entries(raw.images)) {
    if (
      !/^\d+$/.test(id) ||
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry)
    )
      throw new Error(`Invalid psychube image mapping for ${id}`);
    const record = entry as Record<string, unknown>;
    if (
      record.assetPath !== `singlebg/equip_defaulticon/${id}.png` ||
      typeof record.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.sha256)
    )
      throw new Error(`Invalid psychube image mapping for ${id}`);
    if (
      record.source !== undefined &&
      (typeof record.source !== "string" ||
        !/^https:\/\/assets\.merui\.net\/equip_defaulticon\/\d+\.webp$/.test(
          record.source,
        ))
    )
      throw new Error(`Invalid psychube image source for ${id}`);
    images[id] = {
      assetPath: record.assetPath,
      sha256: record.sha256,
      ...(record.source === undefined ? {} : { source: record.source }),
    };
  }
  return { schemaVersion: 1, images };
}

export function loadPsychubeImageInventory(
  inventoryFile = PSYCHUBE_IMAGE_INVENTORY_FILE,
  cacheDir = PSYCHUBE_IMAGE_CACHE_DIR,
): PsychubeImageInventory {
  if (!existsSync(inventoryFile)) return emptyPsychubeImageInventory();
  const parsed = parsePsychubeImageInventory(
    JSON.parse(readFileSync(inventoryFile, "utf-8")) as unknown,
  );
  const images: Record<string, PsychubeImageRecord> = {};
  for (const [id, record] of Object.entries(parsed.images)) {
    const imageFile = path.join(cacheDir, `${id}.png`);
    if (!existsSync(imageFile)) continue;
    const digest = createHash("sha256").update(readFileSync(imageFile)).digest("hex");
    if (digest === record.sha256) images[id] = { ...record };
  }
  return { schemaVersion: 1, images };
}

async function validatePsychubePng(file: string): Promise<void> {
  const metadata = await sharp(file).metadata();
  if (
    metadata.format !== "png" ||
    metadata.width !== 276 ||
    metadata.height !== 228 ||
    (metadata.pages !== undefined && metadata.pages > 1)
  )
    throw new Error(`Invalid psychube PNG: ${path.basename(file)}`);
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || data.length !== 276 * 228 * 4)
    throw new Error(`Psychube PNG did not fully decode: ${path.basename(file)}`);
  for (let offset = 3; offset < data.length; offset += 4)
    if (data[offset] !== 0) return;
  throw new Error(`Psychube PNG is fully transparent: ${path.basename(file)}`);
}

export async function persistPsychubeImageCache(
  ids: readonly string[],
  sourceDir: string,
  cacheDir = PSYCHUBE_IMAGE_CACHE_DIR,
  inventoryFile = PSYCHUBE_IMAGE_INVENTORY_FILE,
  sourceUrls?: ReadonlyMap<string, string>,
): Promise<{ updated: number; missing: string[] }> {
  await mkdir(cacheDir, { recursive: true });
  await mkdir(path.dirname(inventoryFile), { recursive: true });
  const trusted = loadPsychubeImageInventory(inventoryFile, cacheDir);
  const images: Record<string, PsychubeImageRecord> = { ...trusted.images };
  for (const [id, record] of Object.entries(images)) {
    const cached = path.join(cacheDir, `${id}.png`);
    try {
      await validatePsychubePng(cached);
      if (createHash("sha256").update(readFileSync(cached)).digest("hex") !== record.sha256)
        delete images[id];
    } catch {
      delete images[id];
    }
  }

  let updated = 0;
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    if (!/^\d+$/.test(id)) throw new Error(`Invalid psychube ID: ${id}`);
    const source = path.join(sourceDir, `${id}.png`);
    if (!existsSync(source)) {
      if (!images[id]) missing.push(id);
      continue;
    }
    try {
      await validatePsychubePng(source);
    } catch {
      if (!images[id]) missing.push(id);
      continue;
    }

    const digest = createHash("sha256").update(readFileSync(source)).digest("hex");
    if (images[id]?.sha256 === digest) continue;
    const target = path.join(cacheDir, `${id}.png`);
    const temporary = path.join(cacheDir, `.${id}.tmp-${randomUUID()}.png`);
    try {
      await copyFile(source, temporary);
      await validatePsychubePng(temporary);
      await rename(temporary, target);
      const sourceUrl = sourceUrls?.get(id);
      images[id] = {
        assetPath: `singlebg/equip_defaulticon/${id}.png`,
        sha256: digest,
        ...(sourceUrl === undefined ? {} : { source: sourceUrl }),
      };
      updated++;
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  const temporaryInventory = `${inventoryFile}.tmp-${randomUUID()}`;
  try {
    writeFileSync(
      temporaryInventory,
      JSON.stringify({ schemaVersion: 1, images }, null, 2) + "\n",
    );
    await rename(temporaryInventory, inventoryFile);
  } catch (error) {
    await rm(temporaryInventory, { force: true });
    throw error;
  }
  return { updated, missing };
}

export function psychubeImageCacheFile(
  id: string,
  cacheDir = PSYCHUBE_IMAGE_CACHE_DIR,
): string {
  if (!/^\d+$/.test(id)) throw new Error(`Invalid psychube ID: ${id}`);
  return path.join(cacheDir, `${id}.png`);
}

/** Catalog psychubes whose validated icon is still missing; nothing else may borrow an icon. */
export function supplementPsychubeIds(
  catalogIds: readonly string[],
  imageIds: ReadonlySet<string>,
): string[] {
  return [...new Set(catalogIds)].filter((id) => !imageIds.has(id)).sort();
}

/**
 * Fill missing catalog icons from the UTTU mirror. Only images that pass the
 * same 276×228 validation as the primary source are persisted, and each record
 * keeps the URL it came from.
 */
export async function supplementPsychubeIcons(
  ids: readonly string[],
  stagingDir: string,
  cacheDir = PSYCHUBE_IMAGE_CACHE_DIR,
  inventoryFile = PSYCHUBE_IMAGE_INVENTORY_FILE,
  fetcher: FetchBinary = (url, output) => fetchRemoteFile(url, output, 60, 2),
): Promise<{ filled: string[]; unavailable: string[] }> {
  const unavailable: string[] = [];
  const decoded: string[] = [];
  const sources = new Map<string, string>();
  for (const id of ids) {
    const webp = path.join(stagingDir, `${id}.webp`);
    try {
      fetcher(uttuEquipIconUrl(id), webp);
    } catch (error) {
      if (!isUpstreamRefreshError(error)) throw error;
      unavailable.push(id);
      continue;
    }
    // Local read stays outside the classification: only the downloaded bytes are
    // judged as an unusable image.
    const bytes = readFileSync(webp);
    let png: Buffer;
    try {
      png = await decodeLosslessWebpToPng(bytes, `${id}.webp`);
    } catch {
      // An unusable mirror image leaves the icon missing; it never replaces a cached PNG.
      unavailable.push(id);
      continue;
    }
    writeFileSync(path.join(stagingDir, `${id}.png`), png);
    decoded.push(id);
    sources.set(id, uttuEquipIconUrl(id));
  }
  if (decoded.length === 0) return { filled: [], unavailable };
  const persisted = await persistPsychubeImageCache(
    decoded,
    stagingDir,
    cacheDir,
    inventoryFile,
    sources,
  );
  return {
    filled: decoded.filter((id) => !persisted.missing.includes(id)),
    unavailable: [...unavailable, ...persisted.missing],
  };
}
