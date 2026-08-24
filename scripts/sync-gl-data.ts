import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { replaceDirectoryWithRollback } from "./rollback-directory";
import { withPipelineLock } from "./sync-lock";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const GL_DIR = path.join(DATA_DIR, "gl");
const BASE =
  "https://raw.githubusercontent.com/St-Pavlov-Foundation/re1999-data-global/main";
const FILES: Record<string, string> = {
  "character.json": BASE + "/data/json/character.json",
  "equip.json": BASE + "/data/json/equip.json",
  "skin.json": BASE + "/data/json/skin.json",
  "language_zh.json": BASE + "/data/configs/language/language_zh.json",
  "language_tw.json": BASE + "/data/configs/language/language_tw.json",
  "language_jp.json": BASE + "/data/configs/language/language_jp.json",
  "language_kr.json": BASE + "/data/configs/language/language_kr.json",
  "language_en.json": BASE + "/data/configs/language/language_en.json",
};

export const GL_LANG_FILES: Record<string, string> = {
  "zh-CN": "language_zh.json",
  "zh-TW": "language_tw.json",
  "ja-JP": "language_jp.json",
  "ko-KR": "language_kr.json",
  "en-US": "language_en.json",
};

function validateGlFile(
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
  if (name === "character.json" && (value.length < 100 || !hasId(3003)))
    throw new Error("character.json failed minimum/sentinel validation");
  if (name === "equip.json" && (value.length < 100 || !hasId(1201)))
    throw new Error("equip.json failed minimum/sentinel validation");
  if (name === "skin.json" && (value.length < 300 || !hasId(300301)))
    throw new Error("skin.json failed minimum/sentinel validation");
  if (
    name.startsWith("language_") &&
    (value.length < 10_000 ||
      value.some(
        (entry) =>
          typeof entry !== "object" ||
          entry === null ||
          !("key" in entry) ||
          typeof entry.key !== "string" ||
          !("content" in entry) ||
          typeof entry.content !== "string",
      ))
  )
    throw new Error(`${name} failed language schema/minimum validation`);
}

function fetch(url: string, out: string): void {
  execFileSync("curl", ["-fsSL", "-m", "90", "--retry", "2", url, "-o", out], {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

export function loadGlJSON<T>(file: string): T {
  const target = path.join(GL_DIR, file);
  if (!existsSync(target))
    throw new Error(`GL data missing — run npm run sync:gl first (${target})`);
  return JSON.parse(readFileSync(target, "utf-8")) as T;
}

export function loadGlLanguage(lang: string): Record<string, string> {
  const rows = loadGlJSON<Array<{ key?: string; content?: string }>>(
    GL_LANG_FILES[lang] ?? "language_zh.json",
  );
  const out: Record<string, string> = {};
  for (const row of rows) if (row.key) out[row.key] = row.content ?? "";
  return out;
}

async function main(): Promise<void> {
  console.log("sync:gl — validated GL cache with rollback");
  mkdirSync(DATA_DIR, { recursive: true });
  const staging = await mkdtemp(path.join(DATA_DIR, ".gl-staging-"));
  try {
    const meta: Record<string, { bytes: number }> = {};
    for (const [name, url] of Object.entries(FILES)) {
      const out = path.join(staging, name);
      fetch(url, out);
      const raw = readFileSync(out);
      const parsed: unknown = JSON.parse(raw.toString("utf-8"));
      validateGlFile(name, parsed);
      meta[name] = { bytes: raw.length };
      console.log(`  ✓ ${name} (${(raw.length / 1024).toFixed(0)} KB)`);
    }
    writeFileSync(
      path.join(staging, "meta.json"),
      JSON.stringify(meta, null, 2) + "\n",
    );
    await replaceDirectoryWithRollback(staging, GL_DIR);
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
