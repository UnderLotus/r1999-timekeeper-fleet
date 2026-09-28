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

export function validateGlFile(
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

type FetchFile = (url: string, output: string) => void;

function readValidatedPrevious(file: string, name: string): Buffer {
  if (!existsSync(file))
    throw new Error(`GL data missing — cannot reuse ${name} (${file})`);
  const raw = readFileSync(file);
  const parsed = JSON.parse(raw.toString("utf-8")) as unknown;
  validateGlFile(name, parsed);
  return raw;
}

function readValidatedRemote(file: string, name: string): Buffer {
  const raw = readFileSync(file);
  const parsed = parseRemoteJson(raw.toString("utf-8"), name);
  try {
    validateGlFile(name, parsed);
  } catch (error) {
    throw upstreamResponseFailure(`${name} failed upstream validation`, error);
  }
  return raw;
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

export async function synchronizeGlDirectory(
  dataDir = DATA_DIR,
  fetchFile: FetchFile = (url, output) => fetchRemoteFile(url, output, 90, 2),
): Promise<void> {
  const glDir = path.join(dataDir, "gl");
  console.log("sync:gl — validated GL cache with rollback");
  mkdirSync(dataDir, { recursive: true });
  const staging = await mkdtemp(path.join(dataDir, ".gl-staging-"));
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
          `sync:gl warning — ${name}: ${error.message}; reusing validated prior input`,
        );
        raw = readValidatedPrevious(path.join(glDir, name), name);
        writeFileSync(out, raw);
      }
      meta[name] = { bytes: raw.length };
      console.log(`  ✓ ${name} (${(raw.length / 1024).toFixed(0)} KB)`);
    }
    writeFileSync(
      path.join(staging, "meta.json"),
      JSON.stringify(meta, null, 2) + "\n",
    );
    await replaceDirectoryWithRollback(staging, glDir);
    console.log("\n完成");
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.url === "file://" + process.argv[1]) {
  void withPipelineLock(synchronizeGlDirectory).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
