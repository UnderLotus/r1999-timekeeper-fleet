import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCnJSON } from "./sync-cn-data";
import { withPipelineLock } from "./sync-lock";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = "https://raw.githubusercontent.com/windbow27/kornblume/main";
const WIKIRU =
  "https://r.jina.ai/https://reverse1999.wikiru.jp/?%E3%82%AD%E3%83%A3%E3%83%A9%E3%82%AF%E3%82%BF%E3%83%BC%E4%B8%80%E8%A6%A7%28%E3%83%95%E3%82%A3%E3%83%AB%E3%82%BF%E3%83%86%E3%83%BC%E3%83%96%E3%83%AB%E7%89%88%29";
const OUT = path.join(__dirname, "data/name-fallbacks.json");
const ALIASES = path.join(__dirname, "data/jp-name-aliases.json");
const LANGS = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const;
type Lang = (typeof LANGS)[number];
interface Arcanist {
  id: number;
  name: string;
  nameEng: string;
}
interface KbArcanist {
  Id: number;
  Name: string;
  Rarity: number;
}
function fetchText(url: string, maxBuffer = 16 * 1024 * 1024): string {
  return execFileSync("curl", ["-fsSL", "-m", "180", "--retry", "2", url], {
    encoding: "utf-8",
    maxBuffer,
  });
}
function slugify(name: string): string {
  const lower = name.toLowerCase().trim();
  return /^\d+$/.test(lower)
    ? lower
    : lower.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}
function wikiRuMap(
  kbJp: Record<string, string>,
  aliases: Record<string, string>,
): Record<string, string> {
  const markdown = fetchText(WIKIRU);
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
    throw new Error(
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
    try {
      const page = encodeURIComponent(name.replace(/ /g, "_"));
      const response = await fetch(
        `https://reverse1999.fandom.com/api.php?action=parse&page=${page}&format=json&prop=wikitext&origin=*`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) {
        failures++;
        return;
      }
      const data = (await response.json()) as {
        parse?: { wikitext?: { "*"?: string } };
      };
      const text = data.parse?.wikitext?.["*"] ?? "",
        marker = text.indexOf("name_kor=");
      if (marker < 0) return;
      let nameKr = text.slice(marker + 9).trim();
      const end = nameKr.search(/[\n|]/);
      if (end >= 0) nameKr = nameKr.slice(0, end).trim();
      if (nameKr && !/[{}[\]]/.test(nameKr)) result[slugify(name)] = nameKr;
    } catch {
      failures++;
    }
  };
  for (let index = 0; index < arcanists.length; index += 8)
    await Promise.all(
      arcanists.slice(index, index + 8).map((entry) => fetchOne(entry.Name)),
    );
  if (failures > 10)
    throw new Error(`Fandom Korean fallback failed for ${failures} characters`);
  return result;
}
async function main(): Promise<void> {
  console.log("sync:names — Kornblume/wiki/Fandom fallback snapshot\n");
  const names = {} as Record<Lang, Record<string, string>>;
  for (const lang of LANGS)
    names[lang] = JSON.parse(
      fetchText(`${BASE}/lang/static/arcanists/${lang}.json`),
    ) as Record<string, string>;
  const kb = JSON.parse(
    fetchText(`${BASE}/public/data/arcanists.json`),
  ) as KbArcanist[];
  const aliases = Object.fromEntries(
    (
      JSON.parse(readFileSync(ALIASES, "utf-8")) as {
        jpName: string;
        enName: string;
      }[]
    ).map((entry) => [entry.jpName, entry.enName]),
  );
  Object.assign(names["ja-JP"], wikiRuMap(names["ja-JP"], aliases));
  Object.assign(names["ko-KR"], await fandomKr(kb));
  const cnToSlug = new Map(
    Object.entries(names["zh-CN"]).map(([slug, name]) => [name, slug]),
  );
  const rows = loadCnJSON<Arcanist[]>("ArcanistMap.json")
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
    throw new Error(`name fallback snapshot is truncated: ${rows.length}`);
  writeFileSync(
    OUT,
    JSON.stringify({ schemaVersion: 1, rows }, null, 2) + "\n",
  );
  console.log(`fallback rows: ${rows.length}`);
}
void withPipelineLock(main).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
