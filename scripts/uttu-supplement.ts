/**
 * Validated UTTU supplement: the build-time secondary source for CN mapping lag.
 * It never replaces the raw ArcanistMap; merge returns the raw rows plus only
 * the supplemental Variants the primary mapping does not already own.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CnPackageSkin, PackageCharacter } from "./catalog-composition";
import type { NameLang, PartialNames } from "./name-fallbacks";
import {
  buildArcanistVariants,
  buildSkins,
  type ArcanistEntryFull,
} from "./skin-utils";
import type { SkinEntry } from "./types";
import {
  normalizeUttuName,
  UttuOwnershipConflictError,
  type UttuCatalog,
  type UttuGarment,
} from "./uttu-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const UTTU_SUPPLEMENT_SCHEMA_VERSION = 1;
export const UTTU_SUPPLEMENT_FILE = path.join(
  __dirname,
  "data/uttu-supplement.json",
);
/**
 * This run's candidate path. Only the pipeline sets it, so a standalone build or
 * asset sync can never pick up an interrupted run's unfinished admissions.
 */
export function uttuSupplementCandidateFile(): string | undefined {
  const value = process.env.R1999_UTTU_SUPPLEMENT;
  return value && value.trim() ? value : undefined;
}

export const UTTU_SOURCE = {
  profilesUrl: "https://uttu.merui.net/profiles/",
  garmentsUrl: "https://uttu.merui.net/garments/",
  headiconSmallUrl: "https://assets.merui.net/headicon_small/",
  equipDefaultIconUrl: "https://assets.merui.net/equip_defaulticon/",
} as const;

export type UttuSupplementSource = { [K in keyof typeof UTTU_SOURCE]: string };

export interface UttuVariant {
  variantId: string;
  type: SkinEntry["type"];
  name: string | null;
  nameEn: string | null;
}

export interface UttuSupplementCharacter {
  baseId: string;
  name: string;
  nameEng: string;
  names: PartialNames;
  /** On-site star rating; the catalog adapter converts it to `rare`. */
  stars: number;
  defaultVariant: string;
  skins: UttuVariant[];
}

export interface UttuSupplementSkin extends UttuVariant {
  baseId: string;
}

export interface UttuSupplement {
  schemaVersion: typeof UTTU_SUPPLEMENT_SCHEMA_VERSION;
  source: UttuSupplementSource;
  characters: UttuSupplementCharacter[];
  skins: UttuSupplementSkin[];
}

export class UttuSupplementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UttuSupplementError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new UttuSupplementError(`${label} must be a non-empty string`);
  return value;
}

const SUPPLEMENT_NAME_LANGS: readonly NameLang[] = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja-JP",
  "ko-KR",
];

function readNames(value: unknown, label: string): PartialNames {
  if (!isRecord(value))
    throw new UttuSupplementError(`${label} names must be an object`);
  const names: PartialNames = {};
  for (const [lang, rawName] of Object.entries(value)) {
    if (!SUPPLEMENT_NAME_LANGS.includes(lang as NameLang))
      throw new UttuSupplementError(
        `${label} has unsupported name language: ${lang}`,
      );
    const name = normalizeUttuName(rawName);
    if (!name)
      throw new UttuSupplementError(
        `${label} has an empty or N/A name for ${lang}`,
      );
    names[lang as NameLang] = name;
  }
  if (!names["zh-CN"] || !names["en-US"])
    throw new UttuSupplementError(`${label} names require zh-CN and en-US`);
  return names;
}

function readVariant(value: unknown, label: string): UttuVariant {
  if (!isRecord(value))
    throw new UttuSupplementError(`${label} must be an object`);
  const variantId = requireText(value.variantId, `${label}.variantId`);
  if (!/^\d+$/.test(variantId))
    throw new UttuSupplementError(`${label}.variantId must contain only digits`);
  if (
    value.type !== "default" &&
    value.type !== "insight" &&
    value.type !== "skin"
  )
    throw new UttuSupplementError(`${label}.type is invalid`);
  const type = value.type;
  const name = value.name === null ? null : normalizeUttuName(value.name);
  const nameEn =
    value.nameEn === null ? null : normalizeUttuName(value.nameEn);
  if (value.name !== null && name === null)
    throw new UttuSupplementError(`${label}.name is empty or N/A`);
  if (value.nameEn !== null && nameEn === null)
    throw new UttuSupplementError(`${label}.nameEn is empty or N/A`);
  if (type === "default") {
    if (name !== null || nameEn !== null)
      throw new UttuSupplementError(
        `${label} default Variant must not carry garment names`,
      );
  } else if (!name && !nameEn)
    throw new UttuSupplementError(`${label} has no usable garment name`);
  return { variantId, type, name, nameEn };
}

function readSupplementCharacter(
  value: unknown,
  index: number,
): UttuSupplementCharacter {
  if (!isRecord(value))
    throw new UttuSupplementError(
      `Supplement character at index ${index} is invalid`,
    );
  const baseId = value.baseId;
  if (typeof baseId !== "string" || !/^\d+$/.test(baseId) || baseId === "0")
    throw new UttuSupplementError(
      `Supplement character ${index} has an invalid baseId`,
    );
  const names = readNames(value.names, `Supplement character ${baseId}`);
  const name = requireText(value.name, `Supplement character ${baseId}.name`);
  const nameEng = requireText(
    value.nameEng,
    `Supplement character ${baseId}.nameEng`,
  );
  if (name !== names["zh-CN"] || nameEng !== names["en-US"])
    throw new UttuSupplementError(
      `Supplement character ${baseId} name fields disagree with names`,
    );
  if (
    !Number.isInteger(value.stars) ||
    (value.stars as number) < 2 ||
    (value.stars as number) > 6
  )
    throw new UttuSupplementError(
      `Supplement character ${baseId} has invalid stars`,
    );
  const defaultVariant = requireText(
    value.defaultVariant,
    `Supplement character ${baseId}.defaultVariant`,
  );
  if (!Array.isArray(value.skins) || value.skins.length === 0)
    throw new UttuSupplementError(
      `Supplement character ${baseId} has no Variants`,
    );
  const skins = value.skins.map((skin, skinIndex) =>
    readVariant(skin, `Supplement character ${baseId}.skins[${skinIndex}]`),
  );
  const defaults = skins.filter((skin) => skin.type === "default");
  if (defaults.length !== 1)
    throw new UttuSupplementError(
      `Supplement character ${baseId} must have exactly one explicit default`,
    );
  if (skins.filter((skin) => skin.type === "insight").length > 1)
    throw new UttuSupplementError(
      `Supplement character ${baseId} has multiple insight Variants`,
    );
  if (defaults[0].variantId !== defaultVariant)
    throw new UttuSupplementError(
      `Supplement character ${baseId} defaultVariant is not its explicit default`,
    );
  return {
    baseId,
    name,
    nameEng,
    names,
    stars: value.stars as number,
    defaultVariant,
    skins,
  };
}

function readSupplementSkin(
  value: unknown,
  index: number,
): UttuSupplementSkin {
  if (!isRecord(value))
    throw new UttuSupplementError(
      `Supplement skin at index ${index} is invalid`,
    );
  const baseId = value.baseId;
  if (typeof baseId !== "string" || !/^\d+$/.test(baseId) || baseId === "0")
    throw new UttuSupplementError(
      `Supplement skin ${index} has an invalid baseId`,
    );
  return { baseId, ...readVariant(value, `Supplement skin ${index}`) };
}

/** Validate the complete persisted shape before any row reaches the catalog. */
export function parseUttuSupplement(value: unknown): UttuSupplement {
  if (!isRecord(value))
    throw new UttuSupplementError("Supplement must be an object");
  if (value.schemaVersion !== UTTU_SUPPLEMENT_SCHEMA_VERSION)
    throw new UttuSupplementError("Unsupported UTTU supplement schemaVersion");
  if (!isRecord(value.source))
    throw new UttuSupplementError("Supplement source metadata is missing");
  const rawSource = value.source;
  const source = Object.fromEntries(
    (Object.keys(UTTU_SOURCE) as Array<keyof typeof UTTU_SOURCE>).map((key) => [
      key,
      requireText(rawSource[key], `source.${key}`),
    ]),
  ) as UttuSupplementSource;
  if (!Array.isArray(value.characters) || !Array.isArray(value.skins))
    throw new UttuSupplementError(
      "Supplement requires characters[] and skins[]",
    );
  const characters = value.characters.map(readSupplementCharacter);
  const skins = value.skins.map(readSupplementSkin);
  const baseIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const character of characters) {
    if (baseIds.has(character.baseId))
      throw new UttuSupplementError(
        `Duplicate supplement character baseId: ${character.baseId}`,
      );
    baseIds.add(character.baseId);
  }
  for (const character of characters)
    for (const variant of character.skins) {
      if (variantIds.has(variant.variantId))
        throw new UttuSupplementError(
          `Duplicate supplement Variant ID: ${variant.variantId}`,
        );
      variantIds.add(variant.variantId);
    }
  const retainedTypes = new Set<string>();
  for (const skin of skins) {
    if (baseIds.has(skin.baseId))
      throw new UttuSupplementError(
        `Supplement skin ${skin.variantId} duplicates its new character record`,
      );
    if (variantIds.has(skin.variantId))
      throw new UttuSupplementError(
        `Duplicate supplement Variant ID: ${skin.variantId}`,
      );
    variantIds.add(skin.variantId);
    if (skin.type === "skin") continue;
    const key = `${skin.baseId}:${skin.type}`;
    if (retainedTypes.has(key))
      throw new UttuSupplementError(
        `Supplement character ${skin.baseId} has multiple retained ${skin.type} Variants`,
      );
    retainedTypes.add(key);
  }
  characters.sort((left, right) => Number(left.baseId) - Number(right.baseId));
  skins.sort((left, right) =>
    left.baseId === right.baseId
      ? left.variantId.localeCompare(right.variantId)
      : Number(left.baseId) - Number(right.baseId),
  );
  return {
    schemaVersion: UTTU_SUPPLEMENT_SCHEMA_VERSION,
    source,
    characters,
    skins,
  };
}

export function emptyUttuSupplement(): UttuSupplement {
  return {
    schemaVersion: UTTU_SUPPLEMENT_SCHEMA_VERSION,
    source: { ...UTTU_SOURCE },
    characters: [],
    skins: [],
  };
}

export function loadUttuSupplement(
  file: string = UTTU_SUPPLEMENT_FILE,
): UttuSupplement {
  if (!existsSync(file)) return emptyUttuSupplement();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
  } catch (error) {
    throw new UttuSupplementError(
      `Unable to read UTTU supplement ${file}: ${String(error)}`,
    );
  }
  return parseUttuSupplement(parsed);
}

/** The supplement file the build consumes: this run's candidate, else the committed snapshot. */
export function uttuSupplementBuildFile(): string {
  const candidate = uttuSupplementCandidateFile();
  return candidate && existsSync(candidate)
    ? candidate
    : UTTU_SUPPLEMENT_FILE;
}

export function loadUttuSupplementForBuild(): UttuSupplement {
  return loadUttuSupplement(uttuSupplementBuildFile());
}

export function saveUttuSupplement(
  file: string,
  supplement: UttuSupplement,
): void {
  const serialized =
    JSON.stringify(parseUttuSupplement(supplement), null, 2) + "\n";
  mkdirSync(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryFile, serialized);
    renameSync(temporaryFile, file);
  } catch (error) {
    rmSync(temporaryFile, { force: true });
    throw error;
  }
}

/**
 * Commit this run's candidate once its images are installed. The rename stays
 * beside the committed file, so a failure leaves the old snapshot in place.
 */
export function promoteUttuSupplement(
  candidateFile: string,
  targetFile: string = UTTU_SUPPLEMENT_FILE,
): boolean {
  if (!existsSync(candidateFile)) return false;
  renameSync(candidateFile, targetFile);
  return true;
}

interface VariantOwner {
  baseId: string;
  type: SkinEntry["type"];
}

function primaryOwners(
  arcanists: readonly ArcanistEntryFull[],
): Map<string, VariantOwner> {
  const owners = new Map<string, VariantOwner>();
  for (const arcanist of arcanists)
    for (const skin of buildSkins(arcanist))
      owners.set(skin.id, { baseId: String(arcanist.id), type: skin.type });
  return owners;
}

/** A primary default/insight Variant of the same type but a different exact ID. */
function competingPrimaryVariant(
  arcanists: readonly ArcanistEntryFull[],
  owners: ReadonlyMap<string, VariantOwner>,
  baseId: string,
  variant: UttuVariant,
): string | undefined {
  if (variant.type === "skin") return undefined;
  if (!arcanists.some((arcanist) => String(arcanist.id) === baseId))
    return undefined;
  for (const [variantId, owner] of owners)
    if (
      owner.baseId === baseId &&
      owner.type === variant.type &&
      variantId !== variant.variantId
    )
      return variantId;
  return undefined;
}

export interface UttuSupplementMerge {
  supplement: UttuSupplement;
  arcanists: ArcanistEntryFull[];
  characters: PackageCharacter[];
  skins: CnPackageSkin[];
  returnedToPrimary: string[];
  diagnostics: string[];
}

/**
 * Merge the admitted supplement into the raw ArcanistMap. Exact Variant IDs the
 * primary mapping now owns return to primary; every other supplemental Variant
 * is appended with its explicit type. Competing primary default/insight metadata
 * stops the build instead of being resolved by guessing.
 */
export function mergeUttuSupplement(
  arcanists: readonly ArcanistEntryFull[],
  supplement: UttuSupplement,
): UttuSupplementMerge {
  const owners = primaryOwners(arcanists);
  const primaryBaseIds = new Set(
    arcanists.map((arcanist) => String(arcanist.id)),
  );
  const returnedToPrimary = new Set<string>();
  const diagnostics: string[] = [];
  const retainedCharacters: UttuSupplementCharacter[] = [];
  const retainedSkins: UttuSupplementSkin[] = [];

  const returned = (variant: UttuVariant, baseId: string): boolean => {
    const owner = owners.get(variant.variantId);
    if (!owner) return false;
    if (owner.baseId !== baseId)
      throw new UttuOwnershipConflictError(
        `UTTU Variant ${variant.variantId} is owned by primary character ${owner.baseId}, not ${baseId}; sync stopped until the mapping agrees`,
      );
    if (owner.type !== variant.type)
      throw new UttuOwnershipConflictError(
        `UTTU Variant ${variant.variantId} type ${variant.type} conflicts with primary type ${owner.type}; sync stopped until the mapping agrees`,
      );
    returnedToPrimary.add(variant.variantId);
    return true;
  };

  for (const character of supplement.characters) {
    const surviving: UttuVariant[] = [];
    for (const skin of character.skins)
      if (!returned(skin, character.baseId)) surviving.push(skin);
    if (primaryBaseIds.has(character.baseId)) {
      for (const skin of surviving)
        retainedSkins.push({ baseId: character.baseId, ...skin });
      continue;
    }
    retainedCharacters.push({ ...character, skins: surviving });
    for (const skin of surviving)
      owners.set(skin.variantId, { baseId: character.baseId, type: skin.type });
  }

  for (const skin of supplement.skins) {
    if (returned(skin, skin.baseId)) continue;
    const known =
      primaryBaseIds.has(skin.baseId) ||
      retainedCharacters.some((character) => character.baseId === skin.baseId);
    if (!known) {
      diagnostics.push(
        `UTTU Variant ${skin.variantId} has no catalog character ${skin.baseId}; skipped`,
      );
      continue;
    }
    retainedSkins.push({ ...skin });
    owners.set(skin.variantId, { baseId: skin.baseId, type: skin.type });
  }

  for (const skin of retainedSkins) {
    const competing = competingPrimaryVariant(
      arcanists,
      owners,
      skin.baseId,
      skin,
    );
    if (competing)
      throw new UttuOwnershipConflictError(
        `Unsupported primary catch-up for character ${skin.baseId}: admitted ${skin.type} ${skin.variantId} competes with primary ${competing}; resolve the mapping before syncing`,
      );
  }

  retainedSkins.sort((left, right) =>
    left.baseId === right.baseId
      ? left.variantId.localeCompare(right.variantId)
      : Number(left.baseId) - Number(right.baseId),
  );
  const appended = new Map<string, UttuSupplementSkin[]>();
  for (const skin of retainedSkins) {
    const group = appended.get(skin.baseId) ?? [];
    group.push(skin);
    appended.set(skin.baseId, group);
  }
  const effectiveArcanists: ArcanistEntryFull[] = arcanists.map((arcanist) => {
    const extra = appended.get(String(arcanist.id));
    if (!extra) return arcanist;
    return {
      ...arcanist,
      live2d: [
        ...arcanist.live2d,
        ...buildArcanistVariants(
          String(arcanist.id),
          extra.map((skin) => ({
            id: skin.variantId,
            type: skin.type,
            name: skin.name,
            nameEn: skin.nameEn,
          })),
        ),
      ],
    };
  });
  for (const character of retainedCharacters)
    effectiveArcanists.push({
      id: Number(character.baseId),
      name: character.name,
      nameEng: character.nameEng,
      live2d: buildArcanistVariants(
        character.baseId,
        character.skins.map((skin) => ({
          id: skin.variantId,
          type: skin.type,
          name: skin.name,
          nameEn: skin.nameEn,
        })),
      ),
    });
  return {
    supplement: {
      schemaVersion: UTTU_SUPPLEMENT_SCHEMA_VERSION,
      source: { ...supplement.source },
      characters: retainedCharacters,
      skins: retainedSkins,
    },
    arcanists: effectiveArcanists,
    characters: retainedCharacters.map((character) => ({
      id: Number(character.baseId),
      name: character.name,
      nameEng: character.nameEng,
      // UTTU reports stars; the catalog stores the zero-based rare value.
      rare: character.stars - 1,
    })),
    skins: collectSupplementPackageSkins(retainedCharacters, retainedSkins),
    returnedToPrimary: [...returnedToPrimary].sort(),
    diagnostics,
  };
}

/** Every retained Variant as its exact CN-package owner row, deduped by Variant ID. */
function collectSupplementPackageSkins(
  characters: readonly UttuSupplementCharacter[],
  skins: readonly UttuSupplementSkin[],
): CnPackageSkin[] {
  const rows = new Map<string, CnPackageSkin>();
  for (const character of characters)
    for (const skin of character.skins)
      rows.set(skin.variantId, {
        id: Number(skin.variantId),
        characterId: Number(character.baseId),
      });
  for (const skin of skins)
    rows.set(skin.variantId, {
      id: Number(skin.variantId),
      characterId: Number(skin.baseId),
    });
  return [...rows.values()];
}

/**
 * Adapt admitted characters to the CN package row the catalog composes from.
 * Trusted CN columns win field by field; the supplemental row only fills gaps.
 */
export function mergeSupplementPackageCharacters(
  cnCharacters: readonly PackageCharacter[],
  supplementCharacters: readonly PackageCharacter[],
): PackageCharacter[] {
  const trusted = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  const byId = new Map<string, number>();
  const merged = cnCharacters.map((row, index) => {
    byId.set(String(row.id), index);
    return row;
  });
  for (const row of supplementCharacters) {
    const index = byId.get(String(row.id));
    if (index === undefined) {
      merged.push(row);
      continue;
    }
    const existing = merged[index];
    merged[index] = {
      ...existing,
      name: trusted(existing.name) ? existing.name : row.name,
      nameEng: trusted(existing.nameEng) ? existing.nameEng : row.nameEng,
      rare:
        typeof existing.rare === "number" && Number.isFinite(existing.rare)
          ? existing.rare
          : row.rare,
    };
  }
  return merged;
}

export interface UttuPendingItem {
  baseId: string;
  variantId: string;
  name: string;
  nameEng: string;
  reason: string;
}

export interface UttuAdmissionPlan {
  newCharacters: UttuSupplementCharacter[];
  skins: UttuSupplementSkin[];
  pending: UttuPendingItem[];
  diagnostics: string[];
}

/**
 * Select only genuinely new exact IDs: known characters receive real garment
 * Skins only, and a new character needs complete metadata plus a single explicit
 * default. Image readiness is decided by completeUttuAdmissions.
 */
export function planUttuAdmissions(input: {
  catalog: UttuCatalog;
  arcanists: readonly ArcanistEntryFull[];
  supplement: UttuSupplement;
  managedAtStart?: ReadonlySet<string>;
  excludedBaseIds: ReadonlySet<string>;
  ignoredVariantIds: ReadonlySet<string>;
}): UttuAdmissionPlan {
  const owners = primaryOwners(input.arcanists);
  const supplementManaged = new Set(input.managedAtStart);
  for (const character of input.supplement.characters)
    for (const skin of character.skins) {
      owners.set(skin.variantId, { baseId: character.baseId, type: skin.type });
      supplementManaged.add(skin.variantId);
    }
  for (const skin of input.supplement.skins) {
    owners.set(skin.variantId, { baseId: skin.baseId, type: skin.type });
    supplementManaged.add(skin.variantId);
  }
  const knownBaseIds = new Set([
    ...input.arcanists.map((arcanist) => String(arcanist.id)),
    ...input.supplement.characters.map((character) => character.baseId),
  ]);
  const profiles = new Map(
    input.catalog.profiles.map((profile) => [profile.baseId, profile]),
  );
  const diagnostics: string[] = [];
  const pending: UttuPendingItem[] = [];
  const skins: UttuSupplementSkin[] = [];
  const newGarments = new Map<string, UttuGarment[]>();

  for (const garment of input.catalog.garments) {
    const baseId = String(garment.baseId);
    if (input.excludedBaseIds.has(baseId)) continue;
    if (input.ignoredVariantIds.has(garment.variantId)) {
      diagnostics.push(
        `UTTU garment ${garment.variantId} matches a catalog-policy ignored CN skin stub; skipped`,
      );
      continue;
    }
    const owner = owners.get(garment.variantId);
    if (owner !== undefined) {
      if (owner.baseId !== baseId)
        throw new UttuOwnershipConflictError(
          `UTTU Variant ${garment.variantId} is already owned by ${owner.baseId}; the refreshed source claims ${baseId}. Resolve the mapping before syncing`,
        );
      if (owner.type !== garment.type) {
        // Primary-only legacy type guesses do not block gap-only refreshes.
        if (supplementManaged.has(garment.variantId))
          throw new UttuOwnershipConflictError(
            `UTTU Variant ${garment.variantId} is admitted as ${owner.type}; the refreshed source claims ${garment.type}. Resolve the mapping before syncing`,
          );
        continue;
      }
      // Identical exact row already owned: dedupe and keep the known metadata.
      continue;
    }
    if (knownBaseIds.has(baseId)) {
      if (garment.type !== "skin") continue;
      skins.push({
        baseId,
        variantId: garment.variantId,
        type: "skin",
        name: garment.name,
        nameEn: garment.nameEn,
      });
      continue;
    }
    const group = newGarments.get(baseId) ?? [];
    group.push(garment);
    newGarments.set(baseId, group);
  }

  const newCharacters: UttuSupplementCharacter[] = [];
  const addPending = (
    baseId: string,
    name: string,
    nameEng: string,
    reason: string,
  ): void => {
    pending.push({ baseId, variantId: baseId, name, nameEng, reason });
  };
  for (const [baseId, garments] of newGarments) {
    const profile = profiles.get(Number(baseId));
    if (!profile) {
      diagnostics.push(
        `UTTU profile ${baseId} is missing; Variants were not admitted`,
      );
      continue;
    }
    if (input.catalog.incompleteBaseIds.has(profile.baseId)) {
      addPending(
        baseId,
        profile.name,
        profile.nameEng,
        "UTTU character metadata is incomplete",
      );
      continue;
    }
    const defaults = garments.filter((garment) => garment.type === "default");
    if (defaults.length !== 1) {
      addPending(
        baseId,
        profile.name,
        profile.nameEng,
        "UTTU character has no single explicit default",
      );
      continue;
    }
    const rank = (type: SkinEntry["type"]): number =>
      type === "default" ? 0 : type === "insight" ? 1 : 2;
    const ordered = [...garments].sort(
      (left, right) =>
        rank(left.type) - rank(right.type) ||
        left.variantId.localeCompare(right.variantId),
    );
    newCharacters.push({
      baseId,
      name: profile.name,
      nameEng: profile.nameEng,
      names: { ...profile.names },
      stars: profile.stars,
      defaultVariant: defaults[0].variantId,
      skins: ordered.map((garment) => ({
        variantId: garment.variantId,
        type: garment.type,
        name: garment.name,
        nameEn: garment.nameEn,
      })),
    });
  }
  newCharacters.sort(
    (left, right) => Number(left.baseId) - Number(right.baseId),
  );
  skins.sort((left, right) =>
    left.baseId === right.baseId
      ? left.variantId.localeCompare(right.variantId)
      : Number(left.baseId) - Number(right.baseId),
  );
  return { newCharacters, skins, pending, diagnostics };
}

export function collectPlannedVariantIds(
  plan: Pick<UttuAdmissionPlan, "newCharacters" | "skins">,
): string[] {
  return [
    ...new Set([
      ...plan.newCharacters.flatMap((character) =>
        character.skins.map((skin) => skin.variantId),
      ),
      ...plan.skins.map((skin) => skin.variantId),
    ]),
  ].sort();
}

export interface UttuAdmissionOutcome {
  supplement: UttuSupplement;
  pending: UttuPendingItem[];
  diagnostics: string[];
  admittedCharacters: number;
  admittedSkins: number;
}

/**
 * Keep only candidates whose exact image was validated locally, append them to
 * the previous admissions, and leave every prior row untouched.
 */
export function completeUttuAdmissions(
  previous: UttuSupplement,
  plan: UttuAdmissionPlan,
  availableImageIds: ReadonlySet<string>,
): UttuAdmissionOutcome {
  const diagnostics = [...plan.diagnostics];
  const pending = [...plan.pending];
  const characters = previous.characters.map((character) => ({
    ...character,
    skins: [...character.skins],
  }));
  const admittedCharacters = new Map(
    characters.map((character) => [character.baseId, character]),
  );
  const skins: UttuSupplementSkin[] = [];
  let admittedSkins = 0;
  for (const skin of plan.skins) {
    if (!availableImageIds.has(skin.variantId)) {
      diagnostics.push(
        `UTTU Variant ${skin.variantId} is missing a validated headicon; not admitted`,
      );
      continue;
    }
    admittedSkins++;
    const owner = admittedCharacters.get(skin.baseId);
    // A character this supplement already owns keeps its own Variant list; only
    // primary-owned characters need a standalone Skin row.
    if (owner) {
      owner.skins.push({
        variantId: skin.variantId,
        type: skin.type,
        name: skin.name,
        nameEn: skin.nameEn,
      });
      continue;
    }
    skins.push(skin);
  }
  const newCharacters: UttuSupplementCharacter[] = [];
  for (const character of plan.newCharacters) {
    const missing = character.skins
      .map((skin) => skin.variantId)
      .filter((variantId) => !availableImageIds.has(variantId));
    if (missing.length > 0) {
      pending.push({
        baseId: character.baseId,
        variantId: character.defaultVariant,
        name: character.name,
        nameEng: character.nameEng,
        reason: `supplemental headicon missing: ${missing.join(", ")}`,
      });
      continue;
    }
    newCharacters.push(character);
  }
  return {
    supplement: parseUttuSupplement({
      schemaVersion: UTTU_SUPPLEMENT_SCHEMA_VERSION,
      source: { ...UTTU_SOURCE },
      characters: [...characters, ...newCharacters],
      skins: [...previous.skins, ...skins],
    }),
    pending,
    diagnostics,
    admittedCharacters: newCharacters.length,
    admittedSkins,
  };
}

/** Every Variant the supplement currently retains, including character Variants. */
export function collectSupplementVariantIds(
  supplement: UttuSupplement,
): string[] {
  return [
    ...new Set([
      ...supplement.characters.flatMap((character) =>
        character.skins.map((skin) => skin.variantId),
      ),
      ...supplement.skins.map((skin) => skin.variantId),
    ]),
  ].sort();
}

/**
 * Refuse to install or promote a candidate whose Variants are not all in this
 * run's staged image set; a missing Variant means the catalog composition and
 * the candidate disagree.
 */
export function assertSupplementInstalled(
  supplement: UttuSupplement,
  installedVariantIds: ReadonlySet<string>,
): void {
  const missing = collectSupplementVariantIds(supplement).filter(
    (variantId) => !installedVariantIds.has(variantId),
  );
  if (missing.length)
    throw new Error(
      `UTTU supplement Variants are not installed: ${missing.join(", ")}; refusing to install or promote`,
    );
}

/**
 * The candidate must be the exact file build:source composed, otherwise the
 * catalog and the metadata describe different admissions.
 */
export function assertSupplementCandidateHash(
  candidateFile: string,
  sourceHashes: Readonly<Record<string, string>>,
): void {
  const expected = sourceHashes["uttu-supplement.json"];
  if (!expected)
    throw new Error(
      "catalog source did not consume this run's UTTU supplement candidate; run build:source first",
    );
  const actual = createHash("sha256")
    .update(readFileSync(candidateFile))
    .digest("hex");
  if (actual !== expected)
    throw new Error(
      "UTTU supplement candidate changed after build:source; refusing to install or promote",
    );
}
