import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_SOURCE_FILE,
  loadCatalogSource,
  type CatalogSourceSnapshot,
} from "./catalog-source";
import {
  assertKnownCatalogPolicy,
  loadCatalogPolicy,
} from "./catalog-policy";
import {
  composeCatalogSource,
  type Equip,
  type PackageCharacter,
  type CnPackageSkin,
  type PackageSkin,
} from "./catalog-composition";
import {
  GLOBAL_SERVER_UTC_OFFSET_MINUTES,
} from "./release-status";
import {
  loadLocalizedNameOverrides,
  loadNameFallbacks,
  NAME_LANGS,
} from "./name-fallbacks";
import { loadCnJSON } from "./sync-cn-data";
import { loadGlJSON, loadGlLanguage } from "./sync-gl-data";
import type { ArcanistEntryFull } from "./skin-utils";
import {
  computeUnmappedCnSkins,
  mappingDiffFile,
  persistMappingDiff,
  reportUnmappedCnSkins,
} from "./skin-mapping-diff";
import {
  loadUttuSupplementForBuild,
  mergeSupplementPackageCharacters,
  mergeUttuSupplement,
  uttuSupplementBuildFile,
} from "./uttu-supplement";
import {
  indexUttuNames,
  loadUttuNames,
  UTTU_NAMES_FILE,
} from "./uttu-names";

export { completeCatalogNames } from "./catalog-composition";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAPPING_DIFF_FILE = mappingDiffFile();
const POLICY_FILE = path.join(__dirname, "data/catalog-policy.json");
const NAME_FALLBACK_FILE = path.join(__dirname, "data/name-fallbacks.json");
const NAME_OVERRIDES_FILE = path.join(
  __dirname,
  "data/localized-name-overrides.json",
);

type Lang = (typeof NAME_LANGS)[number];

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function extractCatalogSource(): void {
  console.log("build:source — extract compact CN/GL snapshot\n");
  const previousSource = loadCatalogSource();
  const arcanists = loadCnJSON<ArcanistEntryFull[]>("ArcanistMap.json");
  const cnCharacters = loadCnJSON<PackageCharacter[]>("character.json");
  const globalCharacters = loadGlJSON<PackageCharacter[]>("character.json");
  const releaseClock = new Date();
  const cnSkins = loadCnJSON<CnPackageSkin[]>("skin.json");
  const globalSkins = loadGlJSON<PackageSkin[]>("skin.json");
  const globalSkinIds = new Set(globalSkins.map((entry) => String(entry.id)));
  if (globalSkinIds.size !== globalSkins.length)
    throw new Error("Global skin.json contains duplicate IDs");
  const policy = loadCatalogPolicy(POLICY_FILE);
  const cnEquips = loadCnJSON<Equip[]>("equip.json");
  const globalEquips = loadGlJSON<Equip[]>("equip.json");
  assertKnownCatalogPolicy(
    policy,
    new Set(arcanists.map((entry) => String(entry.id))),
    new Set(cnEquips.map((entry) => String(entry.id))),
    new Set(
      arcanists.flatMap((entry) =>
        entry.live2d.map((skin) => String(skin.id)),
      ),
    ),
    new Set(cnSkins.map((entry) => String(entry.id))),
  );
  // Supplemental rows only fill CN mapping lag; the raw ArcanistMap above stays
  // the authority for character existence, Variant ownership and policy checks.
  const supplement = mergeUttuSupplement(
    arcanists,
    loadUttuSupplementForBuild(),
  );
  for (const diagnostic of supplement.diagnostics)
    console.warn(`build:source warning — ${diagnostic}`);
  if (supplement.returnedToPrimary.length)
    console.log(
      `  ArcanistMap now owns supplement Variants: ${supplement.returnedToPrimary.join(", ")}`,
    );
  const knownCharacterIds = new Set(
    supplement.arcanists.map((entry) => String(entry.id)),
  );
  const nameFallbacks = loadNameFallbacks(
    NAME_FALLBACK_FILE,
    knownCharacterIds,
  );
  const nameOverrides = loadLocalizedNameOverrides(
    NAME_OVERRIDES_FILE,
    knownCharacterIds,
  );
  const languages = Object.fromEntries(
    NAME_LANGS.map((lang) => [lang, loadGlLanguage(lang)]),
  ) as Record<Lang, Record<string, string>>;
  const uttuNames = loadUttuNames();
  const { characters, psychubes, warnings } = composeCatalogSource({
    arcanists: supplement.arcanists,
    cnCharacters: mergeSupplementPackageCharacters(
      cnCharacters,
      supplement.characters,
    ),
    globalCharacters,
    cnSkins: [...cnSkins, ...supplement.skins],
    globalSkins,
    cnEquips,
    globalEquips,
    languages,
    nameFallbacks,
    nameOverrides,
    supplementNames: new Map(
      supplement.supplement.characters.map((character) => [
        character.baseId,
        character.names,
      ]),
    ),
    uttuCharacterNames: indexUttuNames(uttuNames.characters),
    uttuPsychubeNames: indexUttuNames(uttuNames.psychubes),
    policy,
    releaseClock,
    globalUtcOffsetMinutes: GLOBAL_SERVER_UTC_OFFSET_MINUTES,
    previousCharacters: previousSource.characters,
    previousPsychubes: previousSource.psychubes,
  });
  for (const warning of warnings) console.warn(`build:source warning — ${warning}`);
  const files = [
    "cn/ArcanistMap.json",
    "cn/character.json",
    "cn/equip.json",
    "cn/skin.json",
    "name-fallbacks.json",
    "localized-name-overrides.json",
    "catalog-policy.json",
    "gl/character.json",
    "gl/equip.json",
    "gl/skin.json",
    "gl/language_zh.json",
    "gl/language_tw.json",
    "gl/language_jp.json",
    "gl/language_kr.json",
    "gl/language_en.json",
  ];
  const sourceHashes = Object.fromEntries(
    files.map((file) => [file, sha256(path.join(__dirname, "data", file))]),
  );
  const supplementFile = uttuSupplementBuildFile();
  if (existsSync(supplementFile))
    sourceHashes["uttu-supplement.json"] = sha256(supplementFile);
  if (existsSync(UTTU_NAMES_FILE))
    sourceHashes["uttu-names.json"] = sha256(UTTU_NAMES_FILE);
  const snapshot: CatalogSourceSnapshot = {
    schemaVersion: 3,
    sourceHashes,
    characters,
    psychubes,
  };
  writeFileSync(CATALOG_SOURCE_FILE, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    `characters: ${characters.length}; skins: ${characters.flatMap((entry) => entry.skins).length}; psychubes: ${psychubes.length}`,
  );
  const mappingDiff = computeUnmappedCnSkins(
    cnSkins,
    supplement.arcanists,
    new Set(policy.ignoredCnSkinStubs.map((entry) => entry.id)),
  );
  const persisted = persistMappingDiff(mappingDiff, MAPPING_DIFF_FILE);
  reportUnmappedCnSkins(mappingDiff, persisted ? MAPPING_DIFF_FILE : null);
}

if (import.meta.url === "file://" + process.argv[1]) extractCatalogSource();
