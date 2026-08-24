/**
 * Deliberate adaptation of roster sync-wiki-list/fetch-huiji-list:
 * Jina avoids the curl_cffi/venv runtime dependency while preserving two-attempt
 * fetch/parse recovery, keep-last dedupe, a >=100 known-character threshold,
 * and validation-before-write.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalogPolicy } from "./catalog-policy";
import { loadCnJSON } from "./sync-cn-data";
import { withPipelineLock } from "./sync-lock";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUIJI =
  "https://r.jina.ai/https://res1999.huijiwiki.com/index.php?title=%E8%A7%92%E8%89%B2%E5%88%97%E8%A1%A8";
const KB_BASE = "https://raw.githubusercontent.com/windbow27/kornblume/main";
interface HuijiCard {
  baseId: string;
  name: string;
}
interface CnCharacter {
  id: number;
  name: string;
  nameEng?: string;
}
interface Arcanist {
  id: number;
  name: string;
  nameEng?: string;
}
interface KbCharacter {
  Id: number;
  Name: string;
  Rarity: number;
}
function fetchText(url: string): string {
  return execFileSync("curl", ["-fsSL", "-m", "180", "--retry", "2", url], {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });
}
export function parseHuijiCards(markdown: string): HuijiCard[] {
  const pattern =
    /Headicon large-(\d+)\.png[^\n]*?\]\(https:\/\/res1999\.huijiwiki\.com\/wiki\/[^ )]+(?: "([^"]*)")?\)/g;
  const deduped = new Map<string, { sequence: number; card: HuijiCard }>();
  let match: RegExpExecArray | null,
    sequence = 0;
  while ((match = pattern.exec(markdown))) {
    const baseId = String(Math.floor(Number(match[1]) / 100));
    deduped.set(baseId, {
      sequence: sequence++,
      card: { baseId, name: match[2] ?? "" },
    });
  }
  return [...deduped.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .map((entry) => entry.card);
}
function fetchKnownHuijiCards(known: ReadonlySet<string>): HuijiCard[] {
  let lastCount = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const cards = parseHuijiCards(fetchText(HUIJI)).filter((entry) =>
      known.has(entry.baseId),
    );
    lastCount = cards.length;
    if (cards.length >= 100) return cards;
    if (attempt === 1)
      console.warn(
        `Huiji parser returned only ${cards.length} known characters; retrying`,
      );
  }
  throw new Error(
    `Huiji parser returned only ${lastCount} known characters after retry`,
  );
}
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
async function main(): Promise<void> {
  console.log("sync:order — live Huiji/Kornblume release order\n");
  const policy = loadCatalogPolicy(
    path.join(__dirname, "data/catalog-policy.json"),
  );
  const excluded = new Set(
    policy.excludedCharacters.map((entry) => entry.baseId),
  );
  const cnCharacters = loadCnJSON<CnCharacter[]>("character.json");
  const cnById = new Map(cnCharacters.map((entry) => [entry.id, entry]));
  const cn = loadCnJSON<Arcanist[]>("ArcanistMap.json").flatMap((entry) => {
    const metadata = cnById.get(entry.id);
    return metadata &&
      !entry.name.includes("???") &&
      !excluded.has(String(entry.id))
      ? [
          {
            ...metadata,
            name: entry.name,
            nameEng: entry.nameEng ?? metadata.nameEng,
          },
        ]
      : [];
  });
  const known = new Set(cn.map((entry) => String(entry.id)));
  const huijiCards = fetchKnownHuijiCards(known);
  const huiji = huijiCards.map((entry) => entry.baseId);
  const huijiSet = new Set(huiji);
  const kbNames = JSON.parse(
    fetchText(`${KB_BASE}/lang/static/arcanists/zh-CN.json`),
  ) as Record<string, string>;
  const kbMeta = JSON.parse(
    fetchText(`${KB_BASE}/public/data/arcanists.json`),
  ) as KbCharacter[];
  const metaBySlug = new Map(
    kbMeta.map((entry) => [slugify(entry.Name), entry]),
  );
  const slugByCn = new Map(
    Object.entries(kbNames).map(([slug, name]) => [name, slug]),
  );
  const kornblume = cn
    .flatMap((entry) => {
      if (huijiSet.has(String(entry.id))) return [];
      const meta = metaBySlug.get(
        slugByCn.get(entry.name) ?? slugify(entry.nameEng ?? ""),
      );
      return meta
        ? [{ baseId: String(entry.id), rarity: meta.Rarity, id: meta.Id }]
        : [];
    })
    .sort((a, b) => b.rarity - a.rarity || a.id - b.id)
    .map((entry) => entry.baseId);
  const output = {
    source: "live Huiji list via Jina; Kornblume fallback; CN-only newest tier",
    huiji,
    kornblume,
  };
  writeFileSync(
    path.join(__dirname, "data/release-order.json"),
    JSON.stringify(output, null, 2) + "\n",
  );
  console.log(
    `Huiji: ${huiji.length}; Kornblume fallback: ${kornblume.length}; CN-only: ${known.size - huiji.length - kornblume.length}`,
  );
}
if (import.meta.url === `file://${process.argv[1]}`)
  void withPipelineLock(main).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
