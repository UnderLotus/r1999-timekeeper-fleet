/** Validate generated catalogs retain the five-locale contract and stable IDs. */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGeneratedCatalog } from "./generated-catalog";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANGS = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const;
let pass = 0,
  fail = 0;
function check(name: string, value: boolean, detail = ""): void {
  if (value) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function validate(
  kind: string,
  entries: Array<{ id?: unknown; names?: Record<string, unknown> }>,
): void {
  const ids = entries.map((entry) =>
    typeof entry.id === "string" ? entry.id : "",
  );
  const invalidIds = ids.filter(
    (id, index) => !id || ids.indexOf(id) !== index,
  );
  check(
    `${kind} IDs are non-empty and unique`,
    invalidIds.length === 0,
    invalidIds.join(","),
  );
  for (const lang of LANGS) {
    const invalid = entries
      .filter(
        (entry) =>
          typeof entry.names?.[lang] !== "string" ||
          !(entry.names[lang] as string).trim() ||
          (entry.names[lang] as string).includes("???"),
      )
      .map((entry) => String(entry.id));
    check(
      `${kind} ${lang} names are complete`,
      invalid.length === 0,
      invalid.join(","),
    );
  }
}
const charsFile = path.join(ROOT, "src/data/characters.ts");
const psychubesFile = path.join(ROOT, "src/data/psychubes.ts");
if (!existsSync(charsFile) || !existsSync(psychubesFile))
  throw new Error(
    "generated catalogs missing; run build:characters/build:psychubes",
  );
const characters = loadGeneratedCatalog<{
  id: string;
  names: Record<string, unknown>;
  skins?: Array<{ id?: string }>;
}>(charsFile);
const psychubes = loadGeneratedCatalog<{
  id: string;
  names: Record<string, unknown>;
}>(psychubesFile);
check("characters catalog is non-empty", characters.length > 0);
check("psychube catalog is non-empty", psychubes.length > 0);
validate("character", characters);
validate("psychube", psychubes);
const variantIds = characters
  .flatMap((character) => character.skins ?? [])
  .map((skin) => skin.id ?? "");
const invalidVariants = variantIds.filter(
  (id, index) => !id || variantIds.indexOf(id) !== index,
);
check(
  "skin variant IDs are non-empty and unique",
  invalidVariants.length === 0,
  invalidVariants.join(","),
);
console.log(`\nname tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
