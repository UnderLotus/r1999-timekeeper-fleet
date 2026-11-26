import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadCatalogSource } from "../../scripts/catalog-source";
import { loadGeneratedCatalog } from "../../scripts/generated-catalog";
import { loadPsychubeImageInventory } from "../../scripts/psychube-catalog";
import type { CharacterDef, PsychubeDef } from "../../src/types/catalog";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CHAR_DIR = path.join(ROOT, "public/assets/characters");
const PSY_DIR = path.join(ROOT, "public/assets/psychubes");

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

describe("committed static asset integrity (ADR 0001)", () => {
  const chars = loadGeneratedCatalog<CharacterDef>(
    path.join(ROOT, "src/data/characters.ts"),
  );
  const psychubes = loadGeneratedCatalog<PsychubeDef>(
    path.join(ROOT, "src/data/psychubes.ts"),
  );

  it("maintains exact coverage between generated catalogs, missing-assets.json, and public/assets WebP files", () => {
    assert.ok(existsSync(CHAR_DIR), "public/assets/characters missing");
    assert.ok(existsSync(PSY_DIR), "public/assets/psychubes missing");

    const expectedChar = new Set(
      chars.flatMap((c) => c.skins.map((skin) => skin.id)),
    );
    const expectedPsy = new Set(psychubes.map((p) => p.id));
    const expectedAll = new Set([...expectedChar, ...expectedPsy]);

    const charFiles = readdirSync(CHAR_DIR).filter((f) => f.endsWith(".webp"));
    const psyFiles = readdirSync(PSY_DIR).filter((f) => f.endsWith(".webp"));
    const installedChar = new Set(charFiles.map((f) => f.slice(0, -5)));
    const installedPsy = new Set(psyFiles.map((f) => f.slice(0, -5)));

    const missingFile = path.join(ROOT, "scripts/data/missing-assets.json");
    const missingManifest: unknown = existsSync(missingFile)
      ? JSON.parse(readFileSync(missingFile, "utf-8"))
      : [];
    assert.ok(Array.isArray(missingManifest));
    const missingIds = missingManifest.filter(
      (id): id is string => typeof id === "string",
    );
    const knownMissing = new Set(missingIds);
    assert.equal(missingIds.length, missingManifest.length);
    assert.ok(missingIds.every((id) => /^\d+$/.test(id)));
    assert.equal(knownMissing.size, missingIds.length);

    assert.deepEqual(
      missingIds.filter((id) => !expectedAll.has(id)),
      [],
      "unknown entries in missing-assets.json",
    );
    assert.deepEqual(
      missingIds.filter(
        (id) =>
          !(
            (expectedChar.has(id) && !installedChar.has(id)) ||
            (expectedPsy.has(id) && !installedPsy.has(id))
          ),
      ),
      [],
      "stale entries in missing-assets.json",
    );

    assert.deepEqual(
      [...expectedChar].filter(
        (id) => !installedChar.has(id) && !knownMissing.has(id),
      ),
      [],
      "missing character variant WebP assets",
    );
    assert.deepEqual(
      [...expectedPsy].filter(
        (id) => !installedPsy.has(id) && !knownMissing.has(id),
      ),
      [],
      "missing psychube WebP assets",
    );

    const pendingCharAssets = new Set(
      loadCatalogSource()
        .characters.filter((row) =>
          row.skins.some(
            (skin) => skin.type !== "skin" && !installedChar.has(skin.id),
          ),
        )
        .flatMap((row) => row.skins.map((skin) => skin.id)),
    );
    assert.deepEqual(
      [...installedChar].filter(
        (id) => !expectedChar.has(id) && !pendingCharAssets.has(id),
      ),
      [],
      "orphan character WebP assets",
    );
    assert.deepEqual(
      [...installedPsy].filter((id) => !expectedPsy.has(id)),
      [],
      "orphan psychube WebP assets",
    );
  });

  it("verifies all psychube source PNGs in inventory decode at 276x228 with visible pixels", async () => {
    const inventoryFile = path.join(
      ROOT,
      "scripts/data/psychube-image-inventory.json",
    );
    const cacheDir = path.join(ROOT, "scripts/data/psychube-image-cache");
    const raw = JSON.parse(readFileSync(inventoryFile, "utf-8")) as {
      images?: Record<string, unknown>;
    };
    const rawIds = Object.keys(raw.images ?? {});
    const trustedIds = Object.keys(loadPsychubeImageInventory().images);
    assert.ok(rawIds.length > 0);
    assert.equal(trustedIds.length, rawIds.length);

    const invalid = (
      await mapConcurrent(trustedIds, 16, async (id) => {
        const file = path.join(cacheDir, `${id}.png`);
        const meta = await sharp(file).metadata();
        if (meta.format !== "png" || meta.width !== 276 || meta.height !== 228)
          return id;
        const decoded = await sharp(file).ensureAlpha().raw().toBuffer();
        for (let offset = 3; offset < decoded.length; offset += 4)
          if (decoded[offset] !== 0) return null;
        return id;
      })
    ).filter((id): id is string => id !== null);
    assert.deepEqual(invalid, [], "invalid cached psychube source PNGs");
  });

  it("verifies all production WebP assets and required UI export assets have valid format and dimensions", async () => {
    const charFiles = readdirSync(CHAR_DIR).filter((f) => f.endsWith(".webp"));
    const psyFiles = readdirSync(PSY_DIR).filter((f) => f.endsWith(".webp"));

    const items = [
      ...charFiles.map((file) => ({ kind: "char" as const, file })),
      ...psyFiles.map((file) => ({ kind: "psy" as const, file })),
    ];
    const invalid = (
      await mapConcurrent(items, 24, async ({ kind, file }) => {
        const dir = kind === "char" ? CHAR_DIR : PSY_DIR;
        const meta = await sharp(path.join(dir, file)).metadata();
        if (meta.format !== "webp" || !meta.width || !meta.height) return file;
        if (
          kind === "char" &&
          (meta.width < 136 || meta.width > 144 || meta.height !== meta.width)
        )
          return file;
        if (kind === "psy" && (meta.width !== 276 || meta.height !== 228))
          return file;
        return null;
      })
    ).filter((file): file is string => file !== null);
    assert.deepEqual(invalid, [], "invalid production WebP dimensions/format");

    const vertinPath = path.join(ROOT, "public/assets/ui/vertin_question.webp");
    assert.ok(existsSync(vertinPath), "vertin_question.webp missing");
    const vertinMeta = await sharp(vertinPath).metadata();
    assert.equal(vertinMeta.format, "webp");
    assert.equal(vertinMeta.width, 400);
    assert.equal(vertinMeta.height, 400);

    assert.ok(
      existsSync(path.join(ROOT, "public/assets/ui/project-qrcode.svg")),
      "project-qrcode.svg missing",
    );
  });
});
