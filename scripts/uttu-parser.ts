/** Parse the public UTTU pages' inline literal arrays without executing site JavaScript. */

import * as ts from "typescript";

import type { NameLang, PartialNames } from "./name-fallbacks";
import type { SkinEntry } from "./types";

export const UTTU_PROFILES_URL = "https://uttu.merui.net/profiles/";
export const UTTU_GARMENTS_URL = "https://uttu.merui.net/garments/";
export const UTTU_PSYCHUBES_URL = "https://uttu.merui.net/psychubes/";


export interface UttuProfile {
  baseId: number;
  name: string;
  nameEng: string;
  names: PartialNames;
  /** On-site star rating (2-6). The catalog stores stars - 1 as `rare`. */
  stars: number;
}

export interface UttuGarment {
  baseId: number;
  variantId: string;
  type: SkinEntry["type"];
  name: string | null;
  nameEn: string | null;
}

export interface UttuCatalog {
  profiles: UttuProfile[];
  garments: UttuGarment[];
  diagnostics: string[];
  /** Profiles with a garment row that could not be normalized. */
  incompleteBaseIds: ReadonlySet<number>;
}

/** Exact-ID locale translations; rows without a usable translation are omitted. */
export interface UttuNameRow {
  id: string;
  names: PartialNames;
}

export class UttuParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UttuParseError";
  }
}

/**
 * Two normalizable rows disagree about one exact Variant. This is a source
 * contradiction, not an upstream outage, so it must stop the run instead of
 * being treated as a transient refresh failure.
 */
export class UttuOwnershipConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UttuOwnershipConflictError";
  }
}

const UNSUPPORTED = Symbol("unsupported-uttu-literal");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trim a literal name and treat empty/N/A placeholders as absent. */
export function normalizeUttuName(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.toUpperCase() === "N/A") return null;
  return name;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function localeNames(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const names: Record<string, string> = {};
  for (const [key, rawName] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const name = normalizeUttuName(rawName);
    if (name) names[key] = name;
  }
  return names;
}

function propertyName(node: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node)
  )
    return node.text;
  return null;
}

/**
 * Read only literal JavaScript values. There is intentionally no eval or vm:
 * downloaded site text is data, so any non-literal field rejects its array.
 */
function literal(node: ts.Expression): unknown | typeof UNSUPPORTED {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node) && node.text === "undefined") return undefined;
  if (ts.isPrefixUnaryExpression(node)) {
    const operand = literal(node.operand);
    if (operand === UNSUPPORTED) return UNSUPPORTED;
    if (node.operator === ts.SyntaxKind.MinusToken && typeof operand === "number")
      return -operand;
    if (node.operator === ts.SyntaxKind.ExclamationToken) return !operand;
    if (node.operator === ts.SyntaxKind.PlusToken && typeof operand === "number")
      return operand;
    return UNSUPPORTED;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const values: unknown[] = [];
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) return UNSUPPORTED;
      const value = literal(element);
      if (value === UNSUPPORTED) return UNSUPPORTED;
      values.push(value);
    }
    return values;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) return UNSUPPORTED;
      const name = propertyName(property.name);
      if (!name || FORBIDDEN_KEYS.has(name)) return UNSUPPORTED;
      const propertyValue = literal(property.initializer);
      if (propertyValue === UNSUPPORTED) return UNSUPPORTED;
      value[name] = propertyValue;
    }
    return value;
  }
  return UNSUPPORTED;
}

function literalArrays(html: string): unknown[][] {
  const arrays: unknown[][] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    const script = match[2];
    if (!script.trim()) continue;
    const source = ts.createSourceFile(
      "uttu-inline.js",
      script,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isArrayLiteralExpression(node)) {
        const value = literal(node);
        if (Array.isArray(value)) arrays.push(value);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return arrays;
}

function isProfileRow(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.ID) &&
    (value.ID as number) > 0 &&
    (typeof value.Name === "string" || typeof value.Name === "number") &&
    isRecord(value.LocaleName)
  );
}

function isGarmentRow(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    isRecord(value.profile) &&
    Number.isSafeInteger(value.profile.ID) &&
    isRecord(value.garment) &&
    Number.isSafeInteger(value.garment.id) &&
    typeof value.garment.category === "string" &&
    isRecord(value.garment.name)
  );
}

/** Recognize arrays by their record shape, never by script order or variable name. */
function chooseArray(
  arrays: readonly unknown[][],
  predicate: (row: unknown) => boolean,
  label: string,
): unknown[] {
  const candidates = arrays.filter(
    (array) => array.length > 0 && array.every((row) => predicate(row)),
  );
  if (candidates.length === 0)
    throw new UttuParseError(`No recognizable UTTU ${label} literal array found`);
  candidates.sort((left, right) => right.length - left.length);
  return candidates[0];
}

const GARMENT_TYPES: Readonly<Record<string, SkinEntry["type"]>> = {
  default: "default",
  insight: "insight",
  advanced: "skin",
  basic: "skin",
  unique: "skin",
  free: "skin",
  roar_jukebox: "skin",
};

const LOCALE_LANGS: Readonly<Record<string, NameLang>> = {
  tw: "zh-TW",
  jp: "ja-JP",
  kr: "ko-KR",
};

function normalizeProfiles(rows: readonly unknown[]): {
  profiles: UttuProfile[];
  diagnostics: string[];
} {
  const profiles: UttuProfile[] = [];
  const diagnostics: string[] = [];
  const seen = new Set<number>();
  for (const raw of rows) {
    if (!isProfileRow(raw)) continue;
    const baseId = raw.ID as number;
    if (seen.has(baseId))
      throw new UttuParseError(`Duplicate UTTU profile ID: ${baseId}`);
    seen.add(baseId);
    if (
      !Number.isInteger(raw.Rarity) ||
      (raw.Rarity as number) < 2 ||
      (raw.Rarity as number) > 6
    ) {
      diagnostics.push(`UTTU profile ${baseId} has invalid stars; skipped`);
      continue;
    }
    const name = normalizeUttuName(raw.Name);
    if (!name) {
      diagnostics.push(`UTTU profile ${baseId} has no usable name; skipped`);
      continue;
    }
    const locales = localeNames(raw.LocaleName);
    const zh = normalizeUttuName(locales.zh);
    const en = normalizeUttuName(locales.en) ?? name;
    if (!zh) {
      diagnostics.push(`UTTU profile ${baseId} has no usable zh name; skipped`);
      continue;
    }
    const names: PartialNames = { "zh-CN": zh, "en-US": en };
    for (const [key, lang] of Object.entries(LOCALE_LANGS)) {
      const localizedName = normalizeUttuName(locales[key]);
      if (localizedName) names[lang] = localizedName;
    }
    profiles.push({
      baseId,
      name: zh,
      nameEng: en,
      names,
      stars: raw.Rarity as number,
    });
  }
  profiles.sort((left, right) => left.baseId - right.baseId);
  return { profiles, diagnostics };
}

function normalizeGarments(
  rows: readonly unknown[],
  profiles: readonly UttuProfile[],
): {
  garments: UttuGarment[];
  diagnostics: string[];
  incompleteBaseIds: Set<number>;
} {
  const profileIds = new Set(profiles.map((profile) => profile.baseId));
  const diagnostics: string[] = [];
  const incompleteBaseIds = new Set<number>();
  const garments = new Map<string, UttuGarment>();
  for (const raw of rows) {
    if (!isGarmentRow(raw)) continue;
    const profile = raw.profile as Record<string, unknown>;
    const garment = raw.garment as Record<string, unknown>;
    const baseId = profile.ID as number;
    const variantId = String(garment.id);
    if (!profileIds.has(baseId)) {
      diagnostics.push(
        `UTTU garment ${variantId} references unknown profile ${baseId}; skipped`,
      );
      continue;
    }
    const type = GARMENT_TYPES[garment.category as string];
    if (!type) {
      diagnostics.push(
        `UTTU garment ${variantId} has unknown category ${String(garment.category)}; skipped`,
      );
      incompleteBaseIds.add(baseId);
      continue;
    }
    const names = localeNames(garment.name);
    const zh = normalizeUttuName(names.zh);
    const en = normalizeUttuName(names.en);
    if (type !== "default" && !zh && !en) {
      diagnostics.push(
        `UTTU garment ${variantId} has no usable garment name; skipped`,
      );
      incompleteBaseIds.add(baseId);
      continue;
    }
    const row: UttuGarment = {
      baseId,
      variantId,
      type,
      name: type === "default" ? null : zh,
      nameEn: type === "default" ? null : en,
    };
    const existing = garments.get(variantId);
    if (!existing) {
      garments.set(variantId, row);
      continue;
    }
    if (existing.baseId !== baseId)
      throw new UttuOwnershipConflictError(
        `UTTU Variant ${variantId} is claimed by both ${existing.baseId} and ${baseId}; resolve the garment ownership before syncing`,
      );
    if (existing.type !== type)
      throw new UttuOwnershipConflictError(
        `UTTU Variant ${variantId} owner ${baseId} is listed as both ${existing.type} and ${type}; resolve the garment type before syncing`,
      );
    // Identical exact rows dedupe; keep the row that carries a garment name.
    if (!existing.name && !existing.nameEn && (zh || en))
      garments.set(variantId, row);
  }
  const garmentRowsResult = [...garments.values()];
  garmentRowsResult.sort((left, right) =>
    left.baseId === right.baseId
      ? left.variantId.localeCompare(right.variantId)
      : left.baseId - right.baseId,
  );
  return { garments: garmentRowsResult, diagnostics, incompleteBaseIds };
}

const NAME_LOCALE_KEYS: Readonly<Record<string, NameLang>> = {
  tw: "zh-TW",
  jp: "ja-JP",
  kr: "ko-KR",
};

/** Name extraction needs only the exact ID and its LocaleName object. */
function isProfileNameRow(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.ID) &&
    (value.ID as number) > 0 &&
    isRecord(value.LocaleName)
  );
}

function localeTranslations(locales: Readonly<Record<string, string>>): PartialNames {
  const names: PartialNames = {};
  for (const [key, lang] of Object.entries(NAME_LOCALE_KEYS)) {
    const name = normalizeUttuName(locales[key]);
    if (name) names[lang] = name;
  }
  return names;
}

/**
 * Read only the profiles page's locale names. A translation must not depend on
 * stars, the CN name or garment metadata being valid.
 */
export function parseUttuProfileNames(html: string): UttuNameRow[] {
  const rows = chooseArray(literalArrays(html), isProfileNameRow, "profile");
  const seen = new Set<string>();
  const names: UttuNameRow[] = [];
  for (const raw of rows) {
    if (!isProfileNameRow(raw)) continue;
    const id = String(raw.ID);
    if (seen.has(id))
      throw new UttuParseError(`Duplicate UTTU profile ID: ${id}`);
    seen.add(id);
    const translated = localeTranslations(localeNames(raw.LocaleName));
    if (Object.keys(translated).length > 0) names.push({ id, names: translated });
  }
  if (names.length === 0)
    throw new UttuParseError("UTTU profiles extracted no localized names");
  names.sort((left, right) => Number(left.id) - Number(right.id));
  return names;
}

/**
 * The psychube page's name array is [en, CN, TW, JP, KR] by position; only the
 * three locales the supplement supplies are extracted.
 */
const PSYCHUBE_NAME_LOCALES: readonly (NameLang | null)[] = [
  null,
  null,
  "zh-TW",
  "ja-JP",
  "ko-KR",
];

function isPsychubeNameRow(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !Array.isArray(value.name)) return false;
  return (
    (typeof value.id === "string" && /^\d+$/.test(value.id)) ||
    Number.isSafeInteger(value.id)
  );
}

/**
 * Read the psychube page's five-locale name arrays by exact `id`; the separate
 * `iconImageId` and slug are never treated as the catalog ID.
 */
export function parseUttuPsychubeNames(html: string): UttuNameRow[] {
  const rows = chooseArray(literalArrays(html), isPsychubeNameRow, "psychube");
  const seen = new Set<string>();
  const names: UttuNameRow[] = [];
  for (const raw of rows) {
    if (!isPsychubeNameRow(raw)) continue;
    const id = String(raw.id);
    if (seen.has(id))
      throw new UttuParseError(`Duplicate UTTU psychube ID: ${id}`);
    seen.add(id);
    const rowNames = raw.name as unknown[];
    if (
      rowNames.length !== PSYCHUBE_NAME_LOCALES.length ||
      rowNames.some((name) => typeof name !== "string")
    )
      throw new UttuParseError(
        `UTTU psychube ${id} does not list exactly five locale names`,
      );
    const translated: PartialNames = {};
    rowNames.forEach((rawName, index) => {
      const lang = PSYCHUBE_NAME_LOCALES[index];
      const name = lang ? normalizeUttuName(rawName) : null;
      if (lang && name) translated[lang] = name;
    });
    if (Object.keys(translated).length > 0)
      names.push({ id, names: translated });
  }
  if (names.length === 0)
    throw new UttuParseError("UTTU psychubes extracted no localized names");
  names.sort((left, right) => Number(left.id) - Number(right.id));
  return names;
}

/**
 * Parse the public Astro pages' inline literal arrays. Arrays are recognized by
 * their record shape, not by script order or minified variable names.
 */
export function parseUttuCatalog(
  profilesHtml: string,
  garmentsHtml: string,
): UttuCatalog {
  const profileRows = chooseArray(
    literalArrays(profilesHtml),
    isProfileRow,
    "profile",
  );
  const garmentRows = chooseArray(
    literalArrays(garmentsHtml),
    isGarmentRow,
    "garment",
  );
  const { profiles, diagnostics: profileDiagnostics } =
    normalizeProfiles(profileRows);
  if (profiles.length === 0)
    throw new UttuParseError("UTTU profiles extracted no valid records");
  const normalizedGarments = normalizeGarments(garmentRows, profiles);
  if (normalizedGarments.garments.length === 0)
    throw new UttuParseError("UTTU garments extracted no valid records");
  return {
    profiles,
    garments: normalizedGarments.garments,
    diagnostics: [...profileDiagnostics, ...normalizedGarments.diagnostics],
    incompleteBaseIds: normalizedGarments.incompleteBaseIds,
  };
}
