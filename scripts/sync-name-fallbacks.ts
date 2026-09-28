import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCnJSON } from "./sync-cn-data";
import {
  fetchRemoteText,
  isUpstreamRefreshError,
  parseRemoteJson,
  upstreamResponseFailure,
} from "./sync-refresh";
import { withPipelineLock } from "./sync-lock";
import {
  loadNameFallbacks,
  NAME_LANGS,
  type NameLang,
  type PartialNames,
} from "./name-fallbacks";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "https://raw.githubusercontent.com/windbow27/kornblume/main";
const WIKIRU =
  "https://r.jina.ai/https://reverse1999.wikiru.jp/?%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC%E4%B8%80%E8%A6%A7%28%E3%83%95%E3%82%A3%E3%83%AB%E3%82%BF%E3%83%86%E3%83%BC%E3%83%96%E3%83%AB%E7%89%88%29";
const OUT = path.join(__dirname, "data/name-fallbacks.json");
const ALIASES = path.join(__dirname, "data/jp-name-aliases.json");
const LANGS = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const;
type Lang = (typeof LANGS)[number];

export interface Arcanist {
  id: number;
  name: string;
  nameEng: string;
}
interface KbArcanist {
  Id: number;
  Name: string;
  Rarity: number;
}
export interface NameFallbackRow {
  baseId: string;
  names: PartialNames;
}

function slugify(name: string): string {
  const lower = name.toLowerCase().trim();
  return /^\d+$/.test(lower)
    ? lower
    : lower.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

function requireRecord(value: unknown, label: string): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw upstreamResponseFailure(`${label} must be an object`);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string")
      throw upstreamResponseFailure(`${label} has an invalid value for ${key}`);
    result[key] = entry;
  }
  return result;
}

function wikiRuMap(
  kbJp: Record<string, string>,
  aliases: Record<string, string>,
): Record<string, string> {
  const markdown = fetchRemoteText(WIKIRU, 180, 16 * 1024 * 1024, 2);
  const jpToSlug = new Map(
    Object.entries(kbJp).map(([slug, name]) => [name, slug]),
  );
  const result: Record<string, string> = {};
  let index = 0;
  while (true) {
    const start = markdown.indexOf("attach2/", index);
    if (start < 0) break;
    index = start + 8;
    let hex = "",
      cursor = index;
    while (cursor < markdown.length && /[0-9a-fA-F_]/.test(markdown[cursor]))
      hex += markdown[cursor++];
    if (!markdown.startsWith(".png) ", cursor)) continue;
    const end = markdown.indexOf("](", cursor + 6);
    if (end < 0) continue;
    const jpName = markdown.slice(cursor + 6, end).trim();
    const clean = hex.replace(/_/g, "");
    if (!jpName || !clean || clean.length % 2) continue;
    const decoded = Buffer.from(clean, "hex").toString("utf-8");
    if (
      decoded.includes("�") ||
      !decoded.startsWith("img") ||
      !decoded.includes("_icon")
    )
      continue;
    const iconName = decoded.slice(3, decoded.indexOf("_icon")).trim();
    const latin = /^[\p{Script=Latin}\p{N} .,'\-]+$/u.test(iconName);
    const slug = latin
      ? slugify(iconName)
      : (jpToSlug.get(jpName) ??
        (aliases[jpName] ? slugify(aliases[jpName]) : undefined));
    if (slug) result[slug] = jpName;
  }
  if (Object.keys(result).length < 30)
    throw upstreamResponseFailure(
      `wikiru parser returned only ${Object.keys(result).length} names`,
    );
  return result;
}

async function fandomKr(
  arcanists: KbArcanist[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let failures = 0;
  const fetchOne = async (name: string): Promise<void> => {
    let response: Response;
    try {
      const page = encodeURIComponent(name.replace(/ /g, "_"));
      response = await fetch(
        `https://reverse1999.fandom.com/api.php?action=parse&page=${page}&format=json&prop=wikitext&origin=*`,
        { signal: AbortSignal.timeout(15_000) },
      );
    } catch {
      failures++;
      return;
    }
    if (!response.ok) {
      failures++;
      return;
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      failures++;
      return;
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      failures++;
      return;
    }
    const text =
      typeof (data as { parse?: unknown }).parse === "object" &&
      (data as { parse?: Record<string, unknown> }).parse !== null
        ? ((data as { parse: { wikitext?: Record<string, unknown> } }).parse
            .wikitext?.["*"] ?? "")
        : "";
    if (typeof text !== "string") {
      failures++;
      return;
    }
    const marker = text.indexOf("name_kor=");
    if (marker < 0) return;
    let nameKr = text.slice(marker + 9).trim();
    const end = nameKr.search(/[\n|]/);
    if (end >= 0) nameKr = nameKr.slice(0, end).trim();
    if (nameKr && !/[{}[\]]/.test(nameKr)) result[slugify(name)] = nameKr;
  };
  for (let index = 0; index < arcanists.length; index += 8)
    await Promise.all(
      arcanists.slice(index, index + 8).map((entry) => fetchOne(entry.Name)),
    );
  if (failures > 10)
    throw upstreamResponseFailure(
      `Fandom Korean fallback failed for ${failures} characters`,
    );
  return result;
}

function parseKornblumeCharacters(value: unknown): KbArcanist[] {
  if (!Array.isArray(value))
    throw upstreamResponseFailure("Kornblume character metadata must be an array");
  const characters = value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw upstreamResponseFailure(`Kornblume character ${index} must be an object`);
    const row = entry as Record<string, unknown>;
    if (
      !Number.isSafeInteger(row.Id) ||
      typeof row.Name !== "string" ||
      typeof row.Rarity !== "number" ||
      !Number.isFinite(row.Rarity)
    )
      throw upstreamResponseFailure(`Kornblume character ${index} is invalid`);
    return { Id: row.Id as number, Name: row.Name, Rarity: row.Rarity };
  });
  if (characters.length < 100)
    throw upstreamResponseFailure(
      `Kornblume character metadata is truncated: ${characters.length}`,
    );
  return characters;
}

export async function acquireNameFallbackRows(
  arcanists: readonly Arcanist[],
  aliases: Record<string, string>,
): Promise<NameFallbackRow[]> {
  const names = {} as Record<Lang, Record<string, string>>;
  for (const lang of LANGS) {
    const parsed = parseRemoteJson(
      fetchRemoteText(
        `${BASE}/lang/static/arcanists/${lang}.json`,
        180,
        16 * 1024 * 1024,
        2,
      ),
      `Kornblume ${lang} names`,
    );
    names[lang] = requireRecord(parsed, `Kornblume ${lang} names`);
  }
  const kb = parseKornblumeCharacters(
    parseRemoteJson(
      fetchRemoteText(`${BASE}/public/data/arcanists.json`, 180, 16 * 1024 * 1024, 2),
      "Kornblume character metadata",
    ),
  );
  Object.assign(names["ja-JP"], wikiRuMap(names["ja-JP"], aliases));
  Object.assign(names["ko-KR"], await fandomKr(kb));
  const cnToSlug = new Map(
    Object.entries(names["zh-CN"]).map(([slug, name]) => [name, slug]),
  );
  const known = new Set(arcanists.map((entry) => String(entry.id)));
  const rows = arcanists
    .flatMap((entry) => {
      const slug =
        cnToSlug.get(entry.name) ??
        (names["en-US"][slugify(entry.nameEng)]
          ? slugify(entry.nameEng)
          : undefined);
      if (!slug) return [];
      const localized = Object.fromEntries(
        LANGS.flatMap((lang) =>
          names[lang][slug] ? [[lang, names[lang][slug]]] : [],
        ),
      );
      return [{ baseId: String(entry.id), names: localized }];
    })
    .sort((a, b) => Number(a.baseId) - Number(b.baseId));
  if (rows.length < 100)
    throw upstreamResponseFailure(
      `name fallback snapshot is truncated: ${rows.length}`,
    );
  if (rows.some((row) => !known.has(row.baseId)))
    throw new Error("Name fallback builder produced an unknown character");
  return rows;
}

function validateFreshRows(
  rows: readonly NameFallbackRow[],
  known: ReadonlySet<string>,
): void {
  if (rows.length < 100)
    throw upstreamResponseFailure(
      `name fallback snapshot is truncated: ${rows.length}`,
    );
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (
      typeof row !== "object" ||
      row === null ||
      !/^\d+$/.test(row.baseId) ||
      !known.has(row.baseId) ||
      seen.has(row.baseId) ||
      typeof row.names !== "object" ||
      row.names === null ||
      Array.isArray(row.names)
    )
      throw upstreamResponseFailure(`name fallback row ${index} is invalid`);
    seen.add(row.baseId);
    for (const [lang, name] of Object.entries(row.names))
      if (
        !NAME_LANGS.includes(lang as NameLang) ||
        typeof name !== "string" ||
        !name.trim()
      )
        throw upstreamResponseFailure(`name fallback row ${index} has invalid ${lang}`);
  }
}

export async function synchronizeNameFallbackFile(
  file: string,
  arcanists: readonly Arcanist[],
  acquire: () => Promise<NameFallbackRow[]>,
): Promise<void> {
  const known = new Set(arcanists.map((entry) => String(entry.id)));
  const previous = existsSync(file) ? loadNameFallbacks(file, known) : null;
  let rows: NameFallbackRow[];
  try {
    rows = await acquire();
    validateFreshRows(rows, known);
  } catch (error) {
    if (!isUpstreamRefreshError(error)) throw error;
    if (!previous)
      throw new Error(
        `Cannot reuse name-fallbacks.json after upstream refresh failure: ${file}`,
      );
    console.warn(
      `sync:names warning — remote refresh failed; retaining validated name-fallbacks.json: ${error.message}`,
    );
    return;
  }
  writeFileSync(
    file,
    JSON.stringify({ schemaVersion: 1, rows }, null, 2) + "\n",
  );
}

async function main(): Promise<void> {
  console.log("sync:names — Kornblume/wiki/Fandom fallback snapshot\n");
  const arcanists = loadCnJSON<Arcanist[]>("ArcanistMap.json");
  const aliases = Object.fromEntries(
    (
      JSON.parse(readFileSync(ALIASES, "utf-8")) as {
        jpName: string;
        enName: string;
      }[]
    ).map((entry) => [entry.jpName, entry.enName]),
  );
  await synchronizeNameFallbackFile(OUT, arcanists, () =>
    acquireNameFallbackRows(arcanists, aliases),
  );
  if (existsSync(OUT)) {
    const rows = loadNameFallbacks(
      OUT,
      new Set(arcanists.map((entry) => String(entry.id))),
    );
    console.log(`fallback rows: ${rows.size}`);
  }
}

if (import.meta.url === "file://" + process.argv[1]) {
  void withPipelineLock(main).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
