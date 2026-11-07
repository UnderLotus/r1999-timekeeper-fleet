/** Validated UTTU headicons: the supplemental image fallback for CN mapping lag. */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { fetchRemoteFile, isUpstreamRefreshError } from "./sync-refresh";
import { hasLosslessWebpChunk } from "./webp-converter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const UTTU_IMAGE_CACHE_DIR = path.join(__dirname, "data/uttu-image-cache");
export const UTTU_HEADICON_URL = "https://assets.merui.net/headicon_small/";
export const UTTU_EQUIP_ICON_URL = "https://assets.merui.net/equip_defaulticon/";

export function uttuHeadiconUrl(variantId: string): string {
  if (!/^\d+$/.test(variantId)) throw new Error(`Invalid Variant ID: ${variantId}`);
  return `${UTTU_HEADICON_URL}${variantId}.webp`;
}

export function uttuEquipIconUrl(id: string): string {
  if (!/^\d+$/.test(id)) throw new Error(`Invalid psychube ID: ${id}`);
  return `${UTTU_EQUIP_ICON_URL}${id}.webp`;
}

export function uttuImageCacheFile(
  variantId: string,
  cacheDir = UTTU_IMAGE_CACHE_DIR,
): string {
  if (!/^\d+$/.test(variantId)) throw new Error(`Invalid Variant ID: ${variantId}`);
  return path.join(cacheDir, `${variantId}.webp`);
}

/**
 * A supplemental headicon must be a lossless 136-144px square that fully decodes
 * and keeps visible pixels. Unlike headicon_middle it may be fully opaque.
 */
export async function validateUttuHeadiconBytes(
  bytes: Buffer,
  label: string,
): Promise<void> {
  if (!hasLosslessWebpChunk(bytes))
    throw new Error(`${label} is not a lossless WebP image`);
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== "webp")
    throw new Error(`${label} did not decode as WebP`);
  const { width, height } = metadata;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width !== height ||
    width < 136 ||
    width > 144
  )
    throw new Error(
      `${label} is not a 136-144px square headicon (${width}x${height})`,
    );
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4 || data.length !== width * height * 4)
    throw new Error(`${label} did not fully decode as RGBA`);
  for (let offset = 3; offset < data.length; offset += 4)
    if (data[offset] !== 0) return;
  throw new Error(`${label} is fully transparent`);
}

export async function validateUttuHeadicon(file: string): Promise<void> {
  const bytes = readFileSync(file);
  await validateUttuHeadiconBytes(bytes, path.basename(file));
}

/** Variant IDs holding cached supplemental bytes; their primary PNG may legitimately be absent. */
export function cachedHeadiconIds(cacheDir = UTTU_IMAGE_CACHE_DIR): string[] {
  if (!existsSync(cacheDir)) return [];
  return readdirSync(cacheDir)
    .filter((file) => /^\d+\.webp$/.test(file))
    .map((file) => file.slice(0, -".webp".length))
    .sort();
}

export async function hasValidUttuHeadicon(file: string): Promise<boolean> {
  if (!existsSync(file)) return false;
  try {
    await validateUttuHeadicon(file);
    return true;
  } catch {
    return false;
  }
}

export type FetchBinary = (url: string, output: string) => void;

/**
 * Validate and keep the exact upstream headicon bytes for one Variant. Returns
 * false when UTTU has no usable image, so admission stays pending.
 */
export async function cacheUttuHeadicon(
  variantId: string,
  cacheDir = UTTU_IMAGE_CACHE_DIR,
  fetcher: FetchBinary = (url, output) => fetchRemoteFile(url, output, 60, 2),
): Promise<boolean> {
  const target = uttuImageCacheFile(variantId, cacheDir);
  if (await hasValidUttuHeadicon(target)) return true;
  mkdirSync(cacheDir, { recursive: true });
  const temporary = path.join(cacheDir, `.${variantId}.tmp-${randomUUID()}.webp`);
  try {
    try {
      fetcher(uttuHeadiconUrl(variantId), temporary);
    } catch (error) {
      if (isUpstreamRefreshError(error)) return false;
      throw error;
    }
    // Local read stays outside the classification: only the downloaded bytes
    // are judged as an unusable image.
    const bytes = readFileSync(temporary);
    try {
      await validateUttuHeadiconBytes(bytes, `${variantId}.webp`);
    } catch {
      return false;
    }
    renameSync(temporary, target);
    return true;
  } finally {
    rmSync(temporary, { force: true });
  }
}
