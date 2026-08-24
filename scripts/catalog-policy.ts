import { readFileSync } from "node:fs";
export interface CatalogPolicy {
  excludedCharacters: { baseId: string; reason: string }[];
  excludedPsychubes: { id: string; reason: string }[];
  characterCapabilities: {
    baseId: string;
    psychubeSlots: 2;
    exclusivePsychubeIds: string[];
    reason: string;
  }[];
}
const isId = (value: unknown): value is string =>
  typeof value === "string" && /^\d+$/.test(value);
const unique = (ids: string[], label: string): void => {
  if (new Set(ids).size !== ids.length)
    throw new Error(`Duplicate ${label} ID`);
};
export function parseCatalogPolicy(value: unknown): CatalogPolicy {
  if (typeof value !== "object" || value === null)
    throw new Error("catalog-policy must be an object");
  const raw = value as Record<string, unknown>;
  if (
    !Array.isArray(raw.excludedCharacters) ||
    !Array.isArray(raw.excludedPsychubes) ||
    !Array.isArray(raw.characterCapabilities)
  )
    throw new Error(
      "catalog-policy requires excludedCharacters, excludedPsychubes, and characterCapabilities arrays",
    );
  const excludedCharacters = raw.excludedCharacters.map((entry, index) => {
    const row = entry as Record<string, unknown>;
    if (
      !row ||
      !isId(row.baseId) ||
      typeof row.reason !== "string" ||
      !row.reason.trim()
    )
      throw new Error(`Invalid excludedCharacters[${index}]`);
    return { baseId: row.baseId, reason: row.reason };
  });
  const excludedPsychubes = raw.excludedPsychubes.map((entry, index) => {
    const row = entry as Record<string, unknown>;
    if (
      !row ||
      !isId(row.id) ||
      typeof row.reason !== "string" ||
      !row.reason.trim()
    )
      throw new Error(`Invalid excludedPsychubes[${index}]`);
    return { id: row.id, reason: row.reason };
  });
  const characterCapabilities = raw.characterCapabilities.map(
    (entry, index) => {
      const row = entry as Record<string, unknown>;
      if (
        !row ||
        !isId(row.baseId) ||
        row.psychubeSlots !== 2 ||
        !Array.isArray(row.exclusivePsychubeIds) ||
        !row.exclusivePsychubeIds.every(isId) ||
        typeof row.reason !== "string" ||
        !row.reason.trim()
      )
        throw new Error(`Invalid characterCapabilities[${index}]`);
      unique(
        row.exclusivePsychubeIds,
        `characterCapabilities[${index}].exclusivePsychubeIds`,
      );
      return {
        baseId: row.baseId,
        psychubeSlots: 2 as const,
        exclusivePsychubeIds: row.exclusivePsychubeIds,
        reason: row.reason,
      };
    },
  );
  unique(
    excludedCharacters.map((entry) => entry.baseId),
    "excluded character",
  );
  unique(
    excludedPsychubes.map((entry) => entry.id),
    "excluded psychube",
  );
  unique(
    characterCapabilities.map((entry) => entry.baseId),
    "character capability",
  );
  return { excludedCharacters, excludedPsychubes, characterCapabilities };
}
export function loadCatalogPolicy(file: string): CatalogPolicy {
  return parseCatalogPolicy(JSON.parse(readFileSync(file, "utf-8")));
}
export function assertKnownCatalogPolicy(
  policy: CatalogPolicy,
  knownCharacters: ReadonlySet<string>,
  knownPsychubes: ReadonlySet<string>,
): void {
  for (const entry of [
    ...policy.excludedCharacters,
    ...policy.characterCapabilities,
  ])
    if (!knownCharacters.has(entry.baseId))
      throw new Error(
        `Catalog policy references unknown character: ${entry.baseId}`,
      );
  for (const entry of policy.excludedPsychubes)
    if (!knownPsychubes.has(entry.id))
      throw new Error(
        `Catalog policy references unknown psychube: ${entry.id}`,
      );
  for (const capability of policy.characterCapabilities)
    for (const id of capability.exclusivePsychubeIds)
      if (!knownPsychubes.has(id))
        throw new Error(
          `Catalog capability references unknown psychube: ${id}`,
        );
}

export function assertKnownCapabilities(
  policy: CatalogPolicy,
  knownCharacters: ReadonlySet<string>,
  knownPsychubes: ReadonlySet<string>,
): void {
  for (const capability of policy.characterCapabilities) {
    if (!knownCharacters.has(capability.baseId))
      throw new Error(
        `Catalog capability references unknown character: ${capability.baseId}`,
      );
    for (const id of capability.exclusivePsychubeIds)
      if (!knownPsychubes.has(id))
        throw new Error(
          `Catalog capability references unknown psychube: ${id}`,
        );
  }
}
