import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CharacterEntry, PsychubeEntry, SkinEntry } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_SOURCE_FILE = path.join(
  __dirname,
  "data/catalog-source.json",
);
type SourceSkinBase = Omit<SkinEntry, "released" | "type">;
export type SourceSkin = SourceSkinBase &
  ({ type: "default" | "insight" } | { type: "skin"; glPresent: boolean });
export interface SourceCharacter
  extends Omit<CharacterEntry, "releaseOrder" | "released" | "skins"> {
  glReleased: boolean;
  skins: SourceSkin[];
}
export interface SourcePsychube extends Omit<PsychubeEntry, "released"> {
  glPresent: boolean;
}
export interface CatalogSourceSnapshot {
  schemaVersion: 3;
  sourceHashes: Record<string, string>;
  characters: SourceCharacter[];
  psychubes: SourcePsychube[];
}

const NAME_LANGS = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const;
const NUMERIC_STRING = /^\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Validate the complete persisted shape of one SourceCharacter row. */
export function isCompleteSourceCharacter(
  value: unknown,
): value is SourceCharacter {
  if (!isRecord(value) || !isRecord(value.names)) return false;
  const names = value.names;
  if (
    typeof value.id !== "string" ||
    !NUMERIC_STRING.test(value.id) ||
    value.baseId !== value.id ||
    !NAME_LANGS.every(
      (lang) =>
        typeof names[lang] === "string" && names[lang].trim().length > 0,
    ) ||
    (value.rarity !== null &&
      (typeof value.rarity !== "number" || !Number.isFinite(value.rarity))) ||
    (value.maxInsight !== 2 && value.maxInsight !== 3) ||
    typeof value.defaultVariant !== "string" ||
    !NUMERIC_STRING.test(value.defaultVariant) ||
    typeof value.glReleased !== "boolean" ||
    !Array.isArray(value.skins)
  )
    return false;

  const variantIds = new Set<string>();
  let defaultCount = 0;
  for (const skin of value.skins) {
    if (
      !isRecord(skin) ||
      typeof skin.id !== "string" ||
      !NUMERIC_STRING.test(skin.id) ||
      variantIds.has(skin.id) ||
      (hasOwn(skin, "name") && typeof skin.name !== "string") ||
      (hasOwn(skin, "nameEn") && typeof skin.nameEn !== "string")
    )
      return false;
    variantIds.add(skin.id);

    if (skin.type === "skin") {
      if (!hasOwn(skin, "glPresent") || typeof skin.glPresent !== "boolean")
        return false;
    } else if (skin.type === "default" || skin.type === "insight") {
      if (hasOwn(skin, "glPresent")) return false;
      if (skin.type === "default") {
        defaultCount++;
        if (skin.id !== value.defaultVariant) return false;
      }
    } else {
      return false;
    }
  }
  return defaultCount === 1;
}

export function loadCatalogSource(): CatalogSourceSnapshot {
  const snapshot: unknown = JSON.parse(
    readFileSync(CATALOG_SOURCE_FILE, "utf-8"),
  );
  if (
    !isRecord(snapshot) ||
    snapshot.schemaVersion !== 3 ||
    !Array.isArray(snapshot.characters) ||
    !Array.isArray(snapshot.psychubes) ||
    snapshot.characters.some((character) => !isCompleteSourceCharacter(character)) ||
    snapshot.psychubes.some(
      (psychube) =>
        !isRecord(psychube) ||
        typeof psychube.id !== "string" ||
        !NUMERIC_STRING.test(psychube.id) ||
        !isRecord(psychube.names) ||
        typeof psychube.glPresent !== "boolean",
    )
  )
    throw new Error("Invalid catalog-source.json; run npm run build:source");
  return snapshot as unknown as CatalogSourceSnapshot;
}
