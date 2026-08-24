/** catalog ↔ 本地資產 exact coverage（LOC-39）。 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadGeneratedCatalog } from "./generated-catalog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.error("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}

async function main(): Promise<void> {
  const chars = loadGeneratedCatalog(
    path.join(ROOT, "src/data/characters.ts"),
  ) as Array<{ id: string; skins: Array<{ id: string }> }>;
  const psychubes = loadGeneratedCatalog(
    path.join(ROOT, "src/data/psychubes.ts"),
  ) as Array<{ id: string }>;

  // 期望角色 variant 集
  const expectedChar = new Set<string>();
  for (const c of chars) for (const s of c.skins) expectedChar.add(s.id);
  const expectedPsy = new Set<string>(psychubes.map((p) => p.id));

  const charDir = path.join(ROOT, "public/assets/characters");
  const psyDir = path.join(ROOT, "public/assets/psychubes");

  check("characters catalog loads", chars.length > 0);
  check("psychubes catalog loads", psychubes.length > 0);

  if (!existsSync(charDir) || !existsSync(psyDir)) {
    check("asset dirs exist", false, "run npm run sync first");
    console.log("\nasset tests: " + pass + " passed, " + fail + " failed");
    if (fail > 0) process.exit(1);
    return;
  }

  const charFiles = readdirSync(charDir).filter((f) => f.endsWith(".webp"));
  const psyFiles = readdirSync(psyDir).filter((f) => f.endsWith(".webp"));

  // 人工審核 exception（手動維護，非 runtime 自動寫入）
  const missingFile = path.join(__dirname, "data", "missing-assets.json");
  const missingManifest: unknown = existsSync(missingFile)
    ? JSON.parse(readFileSync(missingFile, "utf-8"))
    : [];
  const missingIds = Array.isArray(missingManifest)
    ? missingManifest.filter((id): id is string => typeof id === "string")
    : [];
  const knownMissing = new Set(missingIds);
  const expectedAssets = new Set([...expectedChar, ...expectedPsy]);
  check(
    "missing-assets manifest is a numeric unique ID list",
    Array.isArray(missingManifest) &&
      missingIds.length === missingManifest.length &&
      missingIds.every((id) => /^\d+$/.test(id)) &&
      knownMissing.size === missingIds.length,
  );
  const unknownExceptions = missingIds.filter((id) => !expectedAssets.has(id));
  check(
    "missing-assets entries belong to the catalog",
    unknownExceptions.length === 0,
    "unknown: " + unknownExceptions.join(","),
  );
  const staleExceptions = missingIds.filter(
    (id) =>
      !(
        (expectedChar.has(id) && !charFiles.includes(id + ".webp")) ||
        (expectedPsy.has(id) && !psyFiles.includes(id + ".webp"))
      ),
  );
  check(
    "missing-assets has no stale exceptions",
    staleExceptions.length === 0,
    "stale: " + staleExceptions.join(","),
  );
  const missingChar = [...expectedChar].filter(
    (id) => !charFiles.includes(id + ".webp") && !knownMissing.has(id),
  );
  const missingPsy = [...expectedPsy].filter(
    (id) => !psyFiles.includes(id + ".webp") && !knownMissing.has(id),
  );
  check(
    "every character variant has asset",
    missingChar.length === 0,
    "missing: " + missingChar.slice(0, 10).join(","),
  );
  check(
    "every psychube has asset",
    missingPsy.length === 0,
    "missing: " + missingPsy.slice(0, 10).join(","),
  );

  // 無孤兒：assets 沒有 catalog 之外的檔
  const orphanChar = charFiles.filter(
    (f) => !expectedChar.has(f.replace(/\.webp$/, "")),
  );
  const orphanPsy = psyFiles.filter(
    (f) => !expectedPsy.has(f.replace(/\.webp$/, "")),
  );
  check(
    "no orphan character assets",
    orphanChar.length === 0,
    "orphan: " + orphanChar.slice(0, 5).join(","),
  );
  check(
    "no orphan psychube assets",
    orphanPsy.length === 0,
    "orphan: " + orphanPsy.slice(0, 5).join(","),
  );

  // 完整尺寸/格式/alpha 驗證（全部檔案）
  let dimOk = true;
  let dimBad = "";
  for (const f of [...charFiles, ...psyFiles]) {
    const isChar = charFiles.includes(f);
    const dir = isChar ? charDir : psyDir;
    const meta = await sharp(path.join(dir, f)).metadata();
    if (meta.format !== "webp" || !meta.width || !meta.height) {
      dimOk = false;
      dimBad = f;
      break;
    }
    if (
      isChar &&
      (meta.width < 136 || meta.width > 144 || meta.height !== meta.width)
    ) {
      dimOk = false;
      dimBad = f;
      break;
    }
    if (!isChar && (meta.width !== 276 || meta.height !== 228)) {
      dimOk = false;
      dimBad = f;
      break;
    }
  }
  check(
    "all assets are webp with expected dims (char 136×136, psy 276×228)",
    dimOk,
    dimBad,
  );

  const emptyExportAsset = path.join(
    ROOT,
    "public/assets/ui/vertin_question.webp",
  );
  const emptyExportMeta = existsSync(emptyExportAsset)
    ? await sharp(emptyExportAsset).metadata()
    : null;
  check(
    "empty-export Vertin easter egg is the expected 400×400 WebP",
    emptyExportMeta?.format === "webp" &&
      emptyExportMeta.width === 400 &&
      emptyExportMeta.height === 400,
  );

  const favicon = await sharp(path.join(ROOT, "public/favicon.png")).metadata();
  const favicon32 = await sharp(
    path.join(ROOT, "public/favicon-32.png"),
  ).metadata();
  const appleIcon = await sharp(
    path.join(ROOT, "public/apple-touch-icon.png"),
  ).metadata();
  check(
    "suitcase favicon variants have expected dimensions",
    favicon.width === 150 &&
      favicon.height === 150 &&
      favicon.hasAlpha === true &&
      favicon32.width === 32 &&
      favicon32.height === 32 &&
      appleIcon.width === 150 &&
      appleIcon.height === 150,
  );

  console.log("\nasset tests: " + pass + " passed, " + fail + " failed");
  if (fail > 0) process.exit(1);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
