/**
 * sync:uttu — admit UTTU build-time supplement metadata behind a validated image.
 * A failed or empty refresh keeps the previously admitted supplement untouched.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadCatalogPolicy } from "./catalog-policy";
import type { ArcanistEntryFull } from "./skin-utils";
import { loadCnJSON } from "./sync-cn-data";
import { withPipelineLock } from "./sync-lock";
import { fetchRemoteText, isUpstreamRefreshError } from "./sync-refresh";
import { cacheUttuHeadicon, hasValidUttuHeadicon } from "./uttu-images";
import {
  parseUttuCatalog,
  UTTU_GARMENTS_URL,
  UTTU_PROFILES_URL,
  UttuParseError,
  type UttuCatalog,
} from "./uttu-parser";
import { refreshUttuNames } from "./uttu-names";
import {
  collectPlannedVariantIds,
  collectSupplementVariantIds,
  completeUttuAdmissions,
  loadUttuSupplement,
  mergeUttuSupplement,
  planUttuAdmissions,
  saveUttuSupplement,
  uttuSupplementCandidateFile,
} from "./uttu-supplement";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const POLICY_FILE = path.join(__dirname, "data/catalog-policy.json");
const CHAR_ASSET_DIR = path.join(ROOT, "public/assets/characters");

export function fetchUttuCatalog(): UttuCatalog {
  const profiles = fetchRemoteText(UTTU_PROFILES_URL, 60, 4 * 1024 * 1024);
  const garments = fetchRemoteText(UTTU_GARMENTS_URL, 60, 8 * 1024 * 1024);
  return parseUttuCatalog(profiles, garments);
}

/**
 * A failed, empty, or unparseable extraction is a secondary-source outage: the
 * committed supplement stays the build input. Local file corruption is not.
 */
export function fetchUttuCatalogSafely(fetcher: () => UttuCatalog): {
  catalog: UttuCatalog | null;
  warning: string | null;
} {
  try {
    const catalog = fetcher();
    if (catalog.profiles.length === 0 || catalog.garments.length === 0)
      throw new UttuParseError("UTTU extraction returned an empty catalog");
    return { catalog, warning: null };
  } catch (error) {
    if (!(error instanceof UttuParseError) && !isUpstreamRefreshError(error))
      throw error;
    return {
      catalog: null,
      warning: `UTTU refresh failed; keeping the previously admitted supplement: ${error.message}`,
    };
  }
}

/** An exact Variant image is ready once either production or the validated cache holds it. */
async function imageIsReady(variantId: string): Promise<boolean> {
  if (
    await hasValidUttuHeadicon(path.join(CHAR_ASSET_DIR, `${variantId}.webp`))
  )
    return true;
  return cacheUttuHeadicon(variantId);
}

export async function synchronizeUttu(): Promise<void> {
  console.log("sync:uttu — validated build-time supplement\n");
  // Locale names have their own region LKG, so a metadata admission failure or
  // a broken garments page never blocks them.
  const names = refreshUttuNames();
  for (const warning of names.warnings) console.warn(`  warning: ${warning}`);
  console.log(
    `names: ${names.characters} characters, ${names.psychubes} psychubes`,
  );
  const arcanists = loadCnJSON<ArcanistEntryFull[]>("ArcanistMap.json");
  const policy = loadCatalogPolicy(POLICY_FILE);
  const previous = loadUttuSupplement();
  const candidateFile = uttuSupplementCandidateFile();
  const merged = mergeUttuSupplement(arcanists, previous);
  for (const diagnostic of merged.diagnostics)
    console.warn(`  warning: ${diagnostic}`);
  if (merged.returnedToPrimary.length)
    console.log(
      `  ArcanistMap now owns: ${merged.returnedToPrimary.join(", ")}`,
    );

  const refresh = fetchUttuCatalogSafely(fetchUttuCatalog);
  if (!refresh.catalog) {
    console.warn(`  ${refresh.warning}`);
    console.log(
      `supplement unchanged: ${previous.characters.length} characters, ${previous.skins.length} skins`,
    );
    return;
  }

  const plan = planUttuAdmissions({
    catalog: refresh.catalog,
    arcanists,
    supplement: merged.supplement,
    managedAtStart: new Set(collectSupplementVariantIds(previous)),
    excludedBaseIds: new Set(
      policy.excludedCharacters.map((entry) => entry.baseId),
    ),
    ignoredVariantIds: new Set(
      policy.ignoredCnSkinStubs.map((entry) => entry.id),
    ),
  });
  const available = new Set<string>();
  for (const variantId of collectPlannedVariantIds(plan))
    if (await imageIsReady(variantId)) available.add(variantId);
    else
      console.warn(
        `  warning: no validated headicon for Variant ${variantId}; not admitted`,
      );
  const admissions = completeUttuAdmissions(merged.supplement, plan, available);
  for (const diagnostic of admissions.diagnostics)
    console.warn(`  ${diagnostic}`);
  for (const pending of admissions.pending)
    console.warn(
      `  pending: ${pending.baseId} ${pending.name} — ${pending.reason}`,
    );
  if (!candidateFile) {
    // A standalone run only prepares validated images; admissions are committed
    // by the locked pipeline, so no later standalone asset sync can promote them.
    console.log(
      `prepared ${available.size} validated Variant images (${admissions.admittedCharacters} characters, ${admissions.admittedSkins} skins pending); run npm run sync to complete admission`,
    );
    return;
  }
  saveUttuSupplement(candidateFile, admissions.supplement);
  console.log(
    `admitted: ${admissions.admittedCharacters} characters, ${admissions.admittedSkins} skins; supplement ${admissions.supplement.characters.length} characters, ${admissions.supplement.skins.length} skins (candidate staged until assets install)`,
  );
}

if (import.meta.url === "file://" + process.argv[1]) {
  void withPipelineLock(synchronizeUttu).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
