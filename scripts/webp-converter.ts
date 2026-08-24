import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const WEBP_OPTIONS = { lossless: true, effort: 6 } as const;
async function decodeRgba(filePath: string) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4)
    throw new Error(`Expected RGBA image data: ${filePath}`);
  return { data, width: info.width, height: info.height };
}
export async function validateImageParity(
  sourcePath: string,
  outputPath: string,
): Promise<void> {
  const [source, output] = await Promise.all([
    decodeRgba(sourcePath),
    decodeRgba(outputPath),
  ]);
  if (source.width !== output.width || source.height !== output.height)
    throw new Error(
      `Image dimensions differ: ${source.width}x${source.height} vs ${output.width}x${output.height}`,
    );
  for (let offset = 0; offset < source.data.length; offset += 4) {
    const alpha = source.data[offset + 3];
    if (alpha !== output.data[offset + 3])
      throw new Error(`Image alpha differs at pixel ${offset / 4}`);
    if (alpha === 0) continue;
    for (let channel = 0; channel < 3; channel++)
      if (source.data[offset + channel] !== output.data[offset + channel])
        throw new Error(
          `Image RGB differs at pixel ${offset / 4}, channel ${channel}`,
        );
  }
}
function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error))
    return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
async function replaceValidatedFile(
  staging: string,
  output: string,
): Promise<void> {
  try {
    await rename(staging, output);
    return;
  } catch (error) {
    if (!new Set(["EEXIST", "EPERM", "ENOTEMPTY"]).has(errorCode(error) ?? ""))
      throw error;
  }
  const backup = `${output}.backup-${randomUUID()}`;
  await rename(output, backup);
  try {
    await rename(staging, output);
    await rm(backup, { force: true });
  } catch (error) {
    try {
      await rename(backup, output);
    } catch {}
    throw error;
  }
}
export async function convertPngToLosslessWebp(
  input: string,
  output: string,
): Promise<void> {
  if (path.resolve(input) === path.resolve(output))
    throw new Error("Input and output paths must differ");
  await mkdir(path.dirname(output), { recursive: true });
  const staging = `${output}.tmp-${randomUUID()}`;
  try {
    await sharp(input).ensureAlpha().webp(WEBP_OPTIONS).toFile(staging);
    await validateImageParity(input, staging);
    await replaceValidatedFile(staging, output);
  } finally {
    await rm(staging, { force: true });
  }
}
