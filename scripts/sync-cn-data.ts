import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { replaceDirectoryWithRollback } from "./rollback-directory";
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

function validateCnFile(
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

function fetch(url: string, out: string): void {
  execFileSync("curl", ["-fsSL", "-m", "90", "--retry", "2", url, "-o", out], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

export function loadCnJSON<T>(file: string): T {
  const target = path.join(CN_DIR, file);
  if (!existsSync(target))
    throw new Error(`CN data missing — run npm run sync:cn first (${target})`);
  return JSON.parse(readFileSync(target, "utf-8")) as T;
}

async function main(): Promise<void> {
  console.log("sync:cn — validated CN cache with rollback");
  mkdirSync(DATA_DIR, { recursive: true });
  const staging = await mkdtemp(path.join(DATA_DIR, ".cn-staging-"));
  try {
    const meta: Record<string, { bytes: number }> = {};
    for (const [name, url] of Object.entries(FILES)) {
      const out = path.join(staging, name);
      fetch(url, out);
      const raw = readFileSync(out);
      const parsed: unknown = JSON.parse(raw.toString("utf-8"));
      validateCnFile(name, parsed);
      meta[name] = { bytes: raw.length };
      console.log(`  ✓ ${name} (${parsed.length} rows)`);
    }
    writeFileSync(
      path.join(staging, "meta.json"),
      JSON.stringify(meta, null, 2) + "\n",
    );
    await replaceDirectoryWithRollback(staging, CN_DIR);
    console.log("\n完成");
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.url === "file://" + process.argv[1]) {
  void withPipelineLock(main).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
