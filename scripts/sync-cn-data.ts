import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { replaceDirectoryWithRollback } from "./rollback-directory";
import {
  fetchRemoteFile,
  isUpstreamRefreshError,
  parseRemoteJson,
  upstreamResponseFailure,
} from "./sync-refresh";
import { withPipelineLock } from "./sync-lock";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const CN_DIR = path.join(DATA_DIR, "cn");
const DATA_BASE =
  "https://raw.githubusercontent.com/St-Pavlov-Foundation/re1999-data/main";
const ASSET_BASE =
  "https://raw.githubusercontent.com/myssal/Reverse-1999-CN-Asset/master";
const FILES: Record<string, string> = {
  "ArcanistMap.json": ASSET_BASE + "/mappings/ArcanistMap.json",
  "character.json": DATA_BASE + "/data/json/character.json",
  "equip.json": DATA_BASE + "/data/json/equip.json",
  "skin.json": DATA_BASE + "/data/json/skin.json",
};

export function validateCnFile(
  name: string,
  value: unknown,
): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  const hasId = (id: number) =>
    value.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "id" in entry &&
        entry.id === id,
    );
  const minimum = name === "skin.json" ? 300 : 100;
  const sentinel =
    name === "equip.json" ? 1201 : name === "skin.json" ? 300301 : 3003;
  if (value.length < minimum || !hasId(sentinel))
    throw new Error(`${name} failed minimum/sentinel validation`);
}

type FetchFile = (url: string, output: string) => void;

function readValidatedPrevious(file: string, name: string): Buffer {
  if (!existsSync(file))
    throw new Error(`CN data missing — cannot reuse ${name} (${file})`);
  const raw = readFileSync(file);
  const parsed = JSON.parse(raw.toString("utf-8")) as unknown;
  validateCnFile(name, parsed);
  return raw;
}

function readValidatedRemote(file: string, name: string): Buffer {
  const raw = readFileSync(file);
  const parsed = parseRemoteJson(raw.toString("utf-8"), name);
  try {
    validateCnFile(name, parsed);
  } catch (error) {
    throw upstreamResponseFailure(`${name} failed upstream validation`, error);
  }
  return raw;
}

export function loadCnJSON<T>(file: string): T {
  const target = path.join(CN_DIR, file);
  if (!existsSync(target))
    throw new Error(`CN data missing — run npm run sync:cn first (${target})`);
  return JSON.parse(readFileSync(target, "utf-8")) as T;
}

export async function synchronizeCnDirectory(
  dataDir = DATA_DIR,
  fetchFile: FetchFile = (url, output) => fetchRemoteFile(url, output, 90, 2),
): Promise<void> {
  const cnDir = path.join(dataDir, "cn");
  console.log("sync:cn — validated CN cache with rollback");
  mkdirSync(dataDir, { recursive: true });
  const staging = await mkdtemp(path.join(dataDir, ".cn-staging-"));
  try {
    const meta: Record<string, { bytes: number }> = {};
    for (const [name, url] of Object.entries(FILES)) {
      const out = path.join(staging, name);
      let raw: Buffer;
      try {
        fetchFile(url, out);
        raw = readValidatedRemote(out, name);
      } catch (error) {
        if (!isUpstreamRefreshError(error)) throw error;
        console.warn(
          `sync:cn warning — ${name}: ${error.message}; reusing validated prior input`,
        );
        raw = readValidatedPrevious(path.join(cnDir, name), name);
        writeFileSync(out, raw);
      }
      meta[name] = { bytes: raw.length };
      console.log(`  ✓ ${name} (${(JSON.parse(raw.toString("utf-8")) as unknown[]).length} rows)`);
    }
    writeFileSync(
      path.join(staging, "meta.json"),
      JSON.stringify(meta, null, 2) + "\n",
    );
    await replaceDirectoryWithRollback(staging, cnDir);
    console.log("\n完成");
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.url === "file://" + process.argv[1]) {
  void withPipelineLock(synchronizeCnDirectory).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
