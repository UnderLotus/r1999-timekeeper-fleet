import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { useBoxStore } from "../src/store/boxStore";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf-8");

function sourceFiles(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory)).flatMap((name) => {
    const relative = path.join(directory, name);
    const absolute = path.join(ROOT, relative);
    if (statSync(absolute).isDirectory()) return sourceFiles(relative);
    if (!/\.(?:ts|tsx)$/.test(name)) return [];
    if (directory === "scripts" && name.startsWith("test-")) return [];
    return [relative];
  });
}

let pass = 0;
let fail = 0;
function check(name: string, value: boolean): void {
  if (value) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const runtimeBuildSources = [
    ...sourceFiles("src"),
    ...sourceFiles("scripts"),
  ].map(read),
  packageJson = read("package.json"),
  shareCodec = read("src/utils/share-code.ts"),
  assetSync = read("scripts/sync-assets.ts"),
  characterBuilder = read("scripts/build-characters.ts"),
  sourceBuilder = read("scripts/extract-catalog-source.ts"),
  partialize = useBoxStore.persist.getOptions().partialize,
  persisted = (partialize ? partialize(useBoxStore.getState()) : {}) as Record<
    string,
    unknown
  >;

check(
  "runtime and build code have no cross-repo or absolute-path coupling",
  !packageJson.includes("r1999_box_list") &&
    !packageJson.includes("/Users/") &&
    runtimeBuildSources.every(
      (source) =>
        !source.includes("r1999_box_list") && !source.includes("/Users/"),
    ),
);
check(
  "share codec depends on the pure sanitizer, not the Zustand store",
  shareCodec.includes('from "./profile-sanitize"') &&
    !shareCodec.includes("store/boxStore"),
);
check(
  "asset sync stages exact files instead of sparse-checking whole directories",
  !assetSync.includes("SPARSE_DIRS") &&
    !assetSync.includes('["sparse-checkout", "set", "singlebg/'),
);
check(
  "catalog exceptions stay in policy data instead of builder constants",
  !characterBuilder.includes("PSYCHUBE_SLOT_CONFIG") &&
    !sourceBuilder.includes("EXCLUDED_CHARACTER_IDS") &&
    !sourceBuilder.includes("UPGRADE_MATERIAL_IDS"),
);
check(
  "preview and transient UI are excluded from persistence",
  Object.keys(persisted).sort().join(",") === "preferences,profile" &&
    !("previewProfile" in persisted) &&
    !("activeIsPreview" in persisted) &&
    !("ui" in persisted),
);

console.log(`\narchitecture tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
