import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import type { CharacterEntry, PsychubeEntry } from "./types";
import { loadGeneratedCatalog } from "./generated-catalog";
import { convertPngToLosslessWebp } from "./webp-converter";
import { withPipelineLock } from "./sync-lock";
import { assertExactAssetWorktree, exactAssetPaths } from "./asset-source";
import {
  assertKnownPreservedCharacterAssets,
  loadCatalogPolicy,
} from "./catalog-policy";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CHAR_ASSET_DIR = path.join(ROOT, "public/assets/characters");
const PSY_ASSET_DIR = path.join(ROOT, "public/assets/psychubes");
const HASH_CACHE_FILE = path.join(__dirname, "data/asset-hash-cache.json");
const POLICY_FILE = path.join(__dirname, "data/catalog-policy.json");
const ASSET_REPO = "https://github.com/myssal/Reverse-1999-CN-Asset.git";
const SOURCE_ROOT = path.join("/tmp", "r1999-team-asset-sync");
const CHAR_SOURCE = path.join(SOURCE_ROOT, "singlebg/headicon_small");
const PSY_SOURCE = path.join(SOURCE_ROOT, "singlebg/equip_defaulticon");
interface HashEntry {
  png: string;
  webp: string;
}
type HashCache = Record<string, HashEntry>;

function run(command: string, args: string[], cwd?: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
function setExactSparse(paths: readonly string[]): void {
  execFileSync("git", ["sparse-checkout", "set", "--no-cone", "--stdin"], {
    cwd: SOURCE_ROOT,
    input: paths.join("\n") + "\n",
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
function refreshAssetRepo(needed: {
  characters: string[];
  psychubes: string[];
}): void {
  const exactPaths = exactAssetPaths(needed.characters, needed.psychubes);
  if (existsSync(path.join(SOURCE_ROOT, ".git"))) {
    try {
      // Prune a legacy directory-level sparse checkout before any pull can hydrate unrelated blobs.
      setExactSparse(exactPaths);
      run("git", ["pull", "--depth", "1", "--ff-only"], SOURCE_ROOT);
      setExactSparse(exactPaths);
      assertExactAssetWorktree(SOURCE_ROOT, exactPaths);
      console.log(`  ✓ exact-ID incremental pull (${exactPaths.length} files)`);
      return;
    } catch {
      console.warn(
        "  exact-ID incremental pull failed; rebuilding partial clone",
      );
      rmSync(SOURCE_ROOT, { recursive: true, force: true });
    }
  }
  run("git", [
    "clone",
    "--depth",
    "1",
    "--filter=blob:none",
    "--no-checkout",
    ASSET_REPO,
    SOURCE_ROOT,
  ]);
  run("git", ["sparse-checkout", "init", "--no-cone"], SOURCE_ROOT);
  setExactSparse(exactPaths);
  run("git", ["checkout"], SOURCE_ROOT);
  assertExactAssetWorktree(SOURCE_ROOT, exactPaths);
  console.log(`  ✓ exact-ID fresh partial clone (${exactPaths.length} files)`);
}
function collectNeeded(): { characters: string[]; psychubes: string[] } {
  const characters = loadGeneratedCatalog<CharacterEntry>(
    path.join(ROOT, "src/data/characters.ts"),
  );
  const psychubes = loadGeneratedCatalog<PsychubeEntry>(
    path.join(ROOT, "src/data/psychubes.ts"),
  );
  return {
    characters: [
      ...new Set(
        characters.flatMap((entry) => entry.skins.map((skin) => skin.id)),
      ),
    ].sort(),
    psychubes: [...new Set(psychubes.map((entry) => entry.id))].sort(),
  };
}
function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
function loadHashCache(): HashCache {
  if (!existsSync(HASH_CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(HASH_CACHE_FILE, "utf-8")) as HashCache;
  } catch {
    return {};
  }
}
function loadMissingAssets(): Set<string> {
  const file = path.join(__dirname, "data/missing-assets.json");
  if (!existsSync(file)) return new Set();
  const raw: unknown = JSON.parse(readFileSync(file, "utf-8"));
  if (
    !Array.isArray(raw) ||
    raw.some((id) => typeof id !== "string" || !/^\d+$/.test(id))
  )
    throw new Error("missing-assets.json must be a numeric-string array");
  return new Set(raw);
}
async function stageKind(
  kind: "character" | "psychube",
  ids: readonly string[],
  staging: string,
  oldCache: HashCache,
  knownMissing: ReadonlySet<string>,
  preservedCharacterAssets: ReadonlySet<string>,
): Promise<{
  cache: HashCache;
  reused: number;
  converted: number;
  skipped: string[];
}> {
  const sourceDir = kind === "character" ? CHAR_SOURCE : PSY_SOURCE;
  const productionDir = kind === "character" ? CHAR_ASSET_DIR : PSY_ASSET_DIR;
  const expected = kind === "character" ? [136, 136] : [276, 228];
  const nextCache: HashCache = {};
  const skipped: string[] = [];
  let reused = 0;
  let converted = 0;
  for (const id of ids) {
    const output = path.join(staging, `${id}.webp`);
    const production = path.join(productionDir, `${id}.webp`);
    const cacheKey = id;
    if (kind === "character" && preservedCharacterAssets.has(id)) {
      if (!existsSync(production))
        throw new Error(`Preserved character asset is missing: ${id}`);
      await copyFile(production, output);
      const webpHash = sha256(production);
      nextCache[cacheKey] = { png: "preserved", webp: webpHash };
      reused++;
      continue;
    }
    const source = path.join(sourceDir, `${id}.png`);
    if (!existsSync(source)) {
      if (!knownMissing.has(id))
        throw new Error(`Unexpected missing ${kind} source PNG: ${id}`);
      skipped.push(id);
      continue;
    }
    const pngHash = sha256(source);
    const cached = oldCache[id];
    if (
      cached?.png === pngHash &&
      existsSync(production) &&
      sha256(production) === cached.webp
    ) {
      await copyFile(production, output);
      nextCache[cacheKey] = cached;
      reused++;
    } else {
      await convertPngToLosslessWebp(source, output);
      const metadata = await sharp(output).metadata();
      const dimensionsValid =
        kind === "character"
          ? metadata.width !== undefined &&
            metadata.width >= 136 &&
            metadata.width <= 144 &&
            metadata.height === metadata.width
          : metadata.width === expected[0] && metadata.height === expected[1];
      if (!dimensionsValid)
        throw new Error(
          `Invalid ${kind} dimensions for ${id}: ${metadata.width}x${metadata.height}`,
        );
      nextCache[cacheKey] = { png: pngHash, webp: sha256(output) };
      converted++;
    }
  }
  const expectedFiles = new Set(
    ids.filter((id) => !skipped.includes(id)).map((id) => `${id}.webp`),
  );
  const stagedFiles = readdirSync(staging);
  if (
    stagedFiles.length !== expectedFiles.size ||
    stagedFiles.some((file) => !expectedFiles.has(file))
  )
    throw new Error(
      `${kind} staging coverage mismatch: ${stagedFiles.length}/${expectedFiles.size}`,
    );
  return { cache: nextCache, reused, converted, skipped };
}
async function install(
  stagingCharacters: string,
  stagingPsychubes: string,
  cache: HashCache,
): Promise<void> {
  const charBackup = `${CHAR_ASSET_DIR}.backup-${randomUUID()}`;
  const psyBackup = `${PSY_ASSET_DIR}.backup-${randomUUID()}`;
  const cacheStaging = `${HASH_CACHE_FILE}.staging-${randomUUID()}`;
  let charOld = false,
    charNew = false,
    psyOld = false,
    psyNew = false;
  try {
    if (existsSync(CHAR_ASSET_DIR)) {
      await rename(CHAR_ASSET_DIR, charBackup);
      charOld = true;
    }
    await rename(stagingCharacters, CHAR_ASSET_DIR);
    charNew = true;
    if (existsSync(PSY_ASSET_DIR)) {
      await rename(PSY_ASSET_DIR, psyBackup);
      psyOld = true;
    }
    await rename(stagingPsychubes, PSY_ASSET_DIR);
    psyNew = true;
    writeFileSync(cacheStaging, JSON.stringify(cache, null, 2) + "\n");
    await rename(cacheStaging, HASH_CACHE_FILE);
  } catch (error) {
    await rm(cacheStaging, { force: true });
    if (psyNew) await rm(PSY_ASSET_DIR, { recursive: true, force: true });
    if (psyOld) await rename(psyBackup, PSY_ASSET_DIR);
    if (charNew) await rm(CHAR_ASSET_DIR, { recursive: true, force: true });
    if (charOld) await rename(charBackup, CHAR_ASSET_DIR);
    throw error;
  }
  if (charOld) await rm(charBackup, { recursive: true, force: true });
  if (psyOld) await rm(psyBackup, { recursive: true, force: true });
}
async function main(): Promise<void> {
  console.log("sync-assets — exact-ID source cache + hash incremental WebP\n");
  const needed = collectNeeded();
  const policy = loadCatalogPolicy(POLICY_FILE);
  assertKnownPreservedCharacterAssets(policy, new Set(needed.characters));
  const preservedCharacterAssets = new Set(
    policy.preservedCharacterAssets.map((entry) => entry.id),
  );
  refreshAssetRepo(needed);
  const oldCache = loadHashCache();
  const knownMissing = loadMissingAssets();
  const stagingRoot = await mkdtemp(
    path.join(ROOT, "public/assets/.webp-staging-"),
  );
  const chars = path.join(stagingRoot, "characters");
  const psychubes = path.join(stagingRoot, "psychubes");
  await Promise.all([mkdir(chars), mkdir(psychubes)]);
  try {
    const [charResult, psyResult] = await Promise.all([
      stageKind(
        "character",
        needed.characters,
        chars,
        oldCache,
        knownMissing,
        preservedCharacterAssets,
      ),
      stageKind(
        "psychube",
        needed.psychubes,
        psychubes,
        oldCache,
        knownMissing,
        preservedCharacterAssets,
      ),
    ]);
    await install(chars, psychubes, {
      ...charResult.cache,
      ...psyResult.cache,
    });
    console.log(
      `characters: ${charResult.reused} reused, ${charResult.converted} converted, ${charResult.skipped.length} missing`,
    );
    console.log(
      `psychubes: ${psyResult.reused} reused, ${psyResult.converted} converted, ${psyResult.skipped.length} missing`,
    );
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
void withPipelineLock(main).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
