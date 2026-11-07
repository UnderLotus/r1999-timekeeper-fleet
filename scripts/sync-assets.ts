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
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { loadCatalogSource, type CatalogSourceSnapshot } from "./catalog-source";
import {
  classifyMissingCharacterAsset,
  collectCharacterAssetCandidates,
  type CharacterAssetCandidate,
} from "./character-assets";
import {
  effectivePsychubes,
  isTrustedPsychubeName,
  loadPsychubeImageInventory,
  persistPsychubeImageCache,
  psychubeImageCacheFile,
  supplementPsychubeIcons,
  supplementPsychubeIds,
} from "./psychube-catalog";
import { convertPngToLosslessWebp } from "./webp-converter";
import { withPipelineLock } from "./sync-lock";
import {
  cachedHeadiconIds,
  hasValidUttuHeadicon,
  uttuImageCacheFile,
} from "./uttu-images";
import {
  assertSupplementCandidateHash,
  assertSupplementInstalled,
  loadUttuSupplement,
  promoteUttuSupplement,
  uttuSupplementCandidateFile,
} from "./uttu-supplement";
import {
  assertExactAssetWorktree,
  exactAssetPaths,
  numericPsychubeIconIds,
} from "./asset-source";
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
const SOURCE_ROOT = path.join("/tmp", "r1999-team-list-minimal-assets");
const CHAR_SOURCE = path.join(SOURCE_ROOT, "singlebg/headicon_small");
const PSY_SOURCE = path.join(SOURCE_ROOT, "singlebg/equip_defaulticon");
export interface HashEntry {
  png: string;
  webp: string;
}
export type HashCache = Record<string, HashEntry>;

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
function assertRequestedAssets(
  exactPaths: readonly string[],
  characterCandidates: readonly CharacterAssetCandidate[],
  psychubeIds: readonly string[],
  supplementalCharacterIds: ReadonlySet<string>,
): void {
  const optionalCharacterPaths = characterCandidates
    .filter(
      (candidate) =>
        candidate.type === "skin" ||
        supplementalCharacterIds.has(candidate.id),
    )
    .map((candidate) => `singlebg/headicon_small/${candidate.id}.png`);
  const optionalPsychubePaths = psychubeIds.map(
    (id) => `singlebg/equip_defaulticon/${id}.png`,
  );
  assertExactAssetWorktree(SOURCE_ROOT, exactPaths, [
    ...optionalCharacterPaths,
    ...optionalPsychubePaths,
  ]);
}

function listPsychubeIconIdsFromTree(): string[] {
  const output = run(
    "git",
    ["ls-tree", "-r", "--name-only", "HEAD", "--", "singlebg/equip_defaulticon"],
    SOURCE_ROOT,
  );
  const ids = numericPsychubeIconIds(output);
  if (!ids.length)
    throw new Error("CN Asset Git tree has no numeric equip_defaulticon PNG paths");
  return ids;
}

function pathsForAssetIds(
  needed: {
    characters: readonly CharacterAssetCandidate[];
    psychubes: readonly string[];
  },
  treeIconIds: readonly string[],
): string[] {
  const requestedPaths = exactAssetPaths(
    needed.characters.map((candidate) => candidate.id),
    needed.psychubes,
  );
  const treeIconPaths = treeIconIds.map(
    (id) => `singlebg/equip_defaulticon/${id}.png`,
  );
  return [...new Set([...requestedPaths, ...treeIconPaths])].sort();
}

function refreshAssetRepo(
  needed: {
    characters: readonly CharacterAssetCandidate[];
    psychubes: readonly string[];
  },
  supplementalCharacterIds: ReadonlySet<string>,
): string[] {
  const requestedPaths = exactAssetPaths(
    needed.characters.map((candidate) => candidate.id),
    needed.psychubes,
  );
  let reusedClone = existsSync(path.join(SOURCE_ROOT, ".git"));
  if (reusedClone) {
    try {
      // Trim old sparse patterns before pulling; only selected paths can hydrate blobs.
      setExactSparse(requestedPaths);
      run("git", ["pull", "--depth", "1", "--ff-only"], SOURCE_ROOT);
    } catch {
      console.warn("  exact-ID incremental pull failed; rebuilding partial clone");
      rmSync(SOURCE_ROOT, { recursive: true, force: true });
      reusedClone = false;
    }
  }
  if (!reusedClone) {
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
  }

  // ls-tree reads path metadata only; sparse checkout hydrates just this one icon directory.
  const treeIconIds = listPsychubeIconIdsFromTree();
  const exactPaths = pathsForAssetIds(needed, treeIconIds);
  setExactSparse(exactPaths);
  if (!reusedClone) run("git", ["checkout"], SOURCE_ROOT);
  assertRequestedAssets(
    exactPaths,
    needed.characters,
    needed.psychubes,
    supplementalCharacterIds,
  );
  console.log(
    `  ✓ exact-ID ${reusedClone ? "incremental pull" : "fresh partial clone"} (${exactPaths.length} files; ${treeIconIds.length} numeric equip icons)`,
  );
  return treeIconIds;
}
export function collectNeeded(
  source: CatalogSourceSnapshot = loadCatalogSource(),
): { characters: CharacterAssetCandidate[]; psychubes: string[] } {
  return {
    characters: collectCharacterAssetCandidates(source.characters),
    psychubes: [...new Set(source.psychubes.map((entry) => entry.id))].sort(),
  };
}
function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
async function trustedProductionCache(
  kind: "character" | "psychube",
  file: string,
  cached: HashEntry | undefined,
): Promise<HashEntry | undefined> {
  if (!existsSync(file)) return undefined;
  const webpHash = sha256(file);
  if (cached) return cached.webp === webpHash ? cached : undefined;
  let metadata;
  try {
    metadata = await sharp(file).metadata();
  } catch {
    return undefined;
  }
  const valid =
    metadata.format === "webp" &&
    (kind === "character"
      ? metadata.width !== undefined &&
        metadata.width >= 136 &&
        metadata.width <= 144 &&
        metadata.height === metadata.width
      : metadata.width === 276 && metadata.height === 228);
  return valid ? { png: "retained", webp: webpHash } : undefined;
}
const SHA256_HEX = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the persisted asset hash cache without performing any I/O. */
export function parseHashCache(value: unknown): HashCache {
  if (!isRecord(value))
    throw new Error("asset-hash-cache.json must contain an object root");
  const cache: HashCache = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!/^\d+$/.test(id))
      throw new Error(`Invalid asset hash cache ID: ${id}`);
    if (
      !isRecord(raw) ||
      typeof raw.png !== "string" ||
      (!SHA256_HEX.test(raw.png) &&
        raw.png !== "preserved" &&
        raw.png !== "retained") ||
      typeof raw.webp !== "string" ||
      raw.webp.length === 0
    )
      throw new Error(`Invalid asset hash cache entry: ${id}`);
    cache[id] = { png: raw.png, webp: raw.webp };
  }
  return cache;
}

export function loadHashCache(file: string = HASH_CACHE_FILE): HashCache {
  let contents: string;
  try {
    contents = readFileSync(file, "utf-8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return {};
    throw error;
  }
  return parseHashCache(JSON.parse(contents) as unknown);
}
async function stageKind(
  kind: "character" | "psychube",
  items: readonly (string | CharacterAssetCandidate)[],
  staging: string,
  oldCache: HashCache,
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
  for (const item of items) {
    const candidate = typeof item === "string" ? undefined : item;
    const id = typeof item === "string" ? item : item.id;
    const output = path.join(staging, `${id}.webp`);
    const production = path.join(productionDir, `${id}.webp`);
    if (kind === "character" && !candidate)
      throw new Error(`Character asset candidate metadata missing: ${id}`);
    if (kind === "character" && preservedCharacterAssets.has(id)) {
      if (!existsSync(production))
        throw new Error(`Preserved character asset is missing: ${id}`);
      await copyFile(production, output);
      const webpHash = sha256(production);
      nextCache[id] = { png: "preserved", webp: webpHash };
      reused++;
      continue;
    }
    const source =
      kind === "psychube"
        ? psychubeImageCacheFile(id)
        : path.join(sourceDir, `${id}.png`);
    const sourceAvailable = existsSync(source);
    const cached = oldCache[id];
    const trustedPrior =
      kind === "character"
        ? await trustedProductionCache(kind, production, cached)
        : undefined;
    if (!sourceAvailable) {
      if (kind === "psychube") {
        skipped.push(id);
        continue;
      }
      const supplementalFile = uttuImageCacheFile(id);
      const action = classifyMissingCharacterAsset(
        candidate!,
        false,
        Boolean(trustedPrior),
        await hasValidUttuHeadicon(supplementalFile),
      );
      if (action === "install-supplement") {
        // Copy the validated supplemental bytes as-is so visible pixels stay exact.
        // shortcut: an installed supplemental WebP is retained afterwards even if
        // the mirror updates it; delete that WebP to take a newer image.
        const supplementHash = sha256(supplementalFile);
        if (
          cached?.png === supplementHash &&
          existsSync(production) &&
          sha256(production) === cached.webp
        ) {
          await copyFile(production, output);
          nextCache[id] = cached;
          reused++;
        } else {
          await copyFile(supplementalFile, output);
          nextCache[id] = { png: supplementHash, webp: sha256(output) };
          converted++;
        }
        continue;
      }
      if (action === "retain") {
        await copyFile(production, output);
        nextCache[id] = trustedPrior!;
        reused++;
        continue;
      }
      if (action === "skip") {
        console.warn(
          `  warning: skipping Skin Variant ${id} for Character ${candidate!.baseId}: no small source PNG, no supplemental headicon and no trusted prior production WebP`,
        );
        skipped.push(id);
        continue;
      }
      throw new Error(
        `Unexpected missing ${candidate!.type} Variant image: ${id}`,
      );
    }
    const pngHash = sha256(source);
    if (
      cached?.png === pngHash &&
      existsSync(production) &&
      sha256(production) === cached.webp
    ) {
      await copyFile(production, output);
      nextCache[id] = cached;
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
      nextCache[id] = { png: pngHash, webp: sha256(output) };
      converted++;
    }
  }
  const expectedFiles = new Set(
    items
      .map((item) => (typeof item === "string" ? item : item.id))
      .filter((id) => !skipped.includes(id))
      .map((id) => `${id}.webp`),
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
  const source = loadCatalogSource();
  const candidates = collectNeeded(source);
  const candidateFile = uttuSupplementCandidateFile();
  const candidate =
    candidateFile && existsSync(candidateFile)
      ? loadUttuSupplement(candidateFile)
      : undefined;
  if (candidate && candidateFile)
    assertSupplementCandidateHash(candidateFile, source.sourceHashes);
  const policy = loadCatalogPolicy(POLICY_FILE);
  assertKnownPreservedCharacterAssets(
    policy,
    new Set(candidates.characters.map((candidate) => candidate.id)),
  );
  const preservedCharacterAssets = new Set(
    policy.preservedCharacterAssets.map((entry) => entry.id),
  );
  const treeIconIds = refreshAssetRepo(
    candidates,
    new Set(cachedHeadiconIds()),
  );
  const imageCandidateIds = [...new Set([...candidates.psychubes, ...treeIconIds])];
  const iconResult = await persistPsychubeImageCache(
    imageCandidateIds,
    PSY_SOURCE,
  );
  // The secondary mirror only fills catalog icons the primary source lacks.
  const supplementIds = supplementPsychubeIds(
    candidates.psychubes,
    new Set(Object.keys(loadPsychubeImageInventory().images)),
  );
  if (supplementIds.length) {
    const supplementRoot = await mkdtemp(
      path.join(tmpdir(), "r1999-uttu-psychube-"),
    );
    try {
      const supplemented = await supplementPsychubeIcons(
        supplementIds,
        supplementRoot,
      );
      console.log(
        `psychube supplemental icons: ${supplemented.filled.length} installed; ${supplemented.unavailable.length} unavailable`,
      );
      if (supplemented.unavailable.length)
        console.log(
          `  unavailable supplemental icon IDs: ${supplemented.unavailable.join(", ")}`,
        );
    } finally {
      await rm(supplementRoot, { recursive: true, force: true });
    }
  }
  const imageIds = new Set(Object.keys(loadPsychubeImageInventory().images));
  const sourcePsychubes = source.psychubes;
  const sourceById = new Map(sourcePsychubes.map((entry) => [entry.id, entry]));
  const noName = candidates.psychubes.filter(
    (id) => !isTrustedPsychubeName(sourceById.get(id)?.names["zh-CN"]),
  );
  const needed = {
    characters: candidates.characters,
    psychubes: effectivePsychubes(sourcePsychubes, imageIds)
      .map((entry) => entry.id)
      .sort(),
  };
  const missingCatalogIcons = supplementPsychubeIds(
    candidates.psychubes,
    imageIds,
  );
  console.log(
    `psychube image snapshots: ${iconResult.updated} updated; ${missingCatalogIcons.length} catalog IDs still missing an icon`,
  );
  if (missingCatalogIcons.length)
    console.log(
      `  missing catalog icon IDs: ${missingCatalogIcons.join(", ")}`,
    );
  if (noName.length)
    console.log(`  missing trusted zh-CN name IDs: ${noName.join(", ")}`);
  const oldCache = loadHashCache();
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
        preservedCharacterAssets,
      ),
      stageKind(
        "psychube",
        needed.psychubes,
        psychubes,
        oldCache,
        preservedCharacterAssets,
      ),
    ]);
    if (candidate)
      assertSupplementInstalled(candidate, new Set(Object.keys(charResult.cache)));
    await install(chars, psychubes, {
      ...charResult.cache,
      ...psyResult.cache,
    });
    if (candidate && candidateFile && promoteUttuSupplement(candidateFile))
      console.log("  ✓ UTTU supplement metadata committed after asset install");
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
export async function syncAssets(): Promise<void> {
  await withPipelineLock(main);
}
if (import.meta.url === "file://" + process.argv[1]) {
  void syncAssets().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
