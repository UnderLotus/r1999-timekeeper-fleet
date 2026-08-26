import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_SOURCE_FILE,
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

export { completeCatalogNames } from "./catalog-composition";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  const arcanists = loadCnJSON<ArcanistEntryFull[]>("ArcanistMap.json");
  const cnCharacters = loadCnJSON<PackageCharacter[]>("character.json");
  const globalCharacters = loadGlJSON<PackageCharacter[]>("character.json");
  const releaseClock = new Date();
  const cnSkins = loadCnJSON<PackageSkin[]>("skin.json");
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
  );
  const knownCharacterIds = new Set(arcanists.map((entry) => String(entry.id)));
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
  const { characters, psychubes } = composeCatalogSource({
    arcanists,
    cnCharacters,
    globalCharacters,
    cnSkins,
    globalSkins,
    cnEquips,
    globalEquips,
    languages,
    nameFallbacks,
    nameOverrides,
    policy,
    releaseClock,
    globalUtcOffsetMinutes: GLOBAL_SERVER_UTC_OFFSET_MINUTES,
  });
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
}

if (import.meta.url === "file://" + process.argv[1]) extractCatalogSource();
