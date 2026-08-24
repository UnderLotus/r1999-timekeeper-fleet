import { readFileSync } from "node:fs";
export const NAME_LANGS = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja-JP",
  "ko-KR",
] as const;
export type NameLang = (typeof NAME_LANGS)[number];
export type PartialNames = Partial<Record<NameLang, string>>;
interface NameRow {
  baseId: string;
  names: PartialNames;
}
function parseNames(value: unknown, label: string): PartialNames {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label}.names must be an object`);
  const raw = value as Record<string, unknown>,
    names: PartialNames = {};
  for (const [lang, name] of Object.entries(raw)) {
    if (
      !NAME_LANGS.includes(lang as NameLang) ||
      typeof name !== "string" ||
      !name.trim()
    )
      throw new Error(`${label} has invalid ${lang} name`);
    names[lang as NameLang] = name.trim();
  }
  return names;
}
function indexRows(
  rows: NameRow[],
  label: string,
  known: ReadonlySet<string>,
): Map<string, PartialNames> {
  const result = new Map<string, PartialNames>();
  for (const row of rows) {
    if (!/^\d+$/.test(row.baseId))
      throw new Error(`${label} has invalid baseId`);
    if (!known.has(row.baseId))
      throw new Error(`${label} references unknown character: ${row.baseId}`);
    if (result.has(row.baseId))
      throw new Error(`${label} has duplicate character: ${row.baseId}`);
    result.set(row.baseId, row.names);
  }
  return result;
}
export function loadNameFallbacks(
  file: string,
  known: ReadonlySet<string>,
): Map<string, PartialNames> {
  const value = JSON.parse(readFileSync(file, "utf-8")) as {
    schemaVersion?: unknown;
    rows?: unknown;
  };
  if (
    value.schemaVersion !== 1 ||
    !Array.isArray(value.rows) ||
    value.rows.length < 100
  )
    throw new Error("Invalid/truncated name-fallbacks.json");
  const rows = value.rows.map((entry, index) => {
    const raw = entry as Record<string, unknown>;
    if (!raw || typeof raw.baseId !== "string")
      throw new Error(`Invalid name fallback row ${index}`);
    return {
      baseId: raw.baseId,
      names: parseNames(raw.names, `name fallback ${index}`),
    };
  });
  return indexRows(rows, "Name fallback", known);
}
export function loadLocalizedNameOverrides(
  file: string,
  known: ReadonlySet<string>,
): Map<string, PartialNames> {
  const value = JSON.parse(readFileSync(file, "utf-8"));
  if (!Array.isArray(value))
    throw new Error("localized-name-overrides.json must be an array");
  const rows = value.map((entry, index) => {
    const raw = entry as Record<string, unknown>;
    if (
      !raw ||
      typeof raw.baseId !== "string" ||
      typeof raw.source !== "string" ||
      !raw.source.trim()
    )
      throw new Error(`Invalid localized name override ${index}`);
    return {
      baseId: raw.baseId,
      names: parseNames(raw.names, `localized override ${index}`),
    };
  });
  return indexRows(rows, "Localized name override", known);
}
