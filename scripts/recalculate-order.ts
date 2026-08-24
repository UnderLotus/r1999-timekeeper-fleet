import type { CharacterEntry } from "./types";

export interface ReleaseOrderSources {
  source?: string;
  huiji: string[];
  kornblume: string[];
}

export function parseReleaseOrderSources(value: unknown): ReleaseOrderSources {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("release-order.json must be an object");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.huiji) || !Array.isArray(raw.kornblume))
    throw new Error("release-order.json requires huiji[] and kornblume[]");
  if (raw.source !== undefined && typeof raw.source !== "string")
    throw new Error("release-order.json source must be a string");
  const parseIds = (ids: unknown[], label: string): string[] =>
    ids.map((id, index) => {
      if (typeof id !== "string" || !/^\d+$/.test(id))
        throw new Error(`${label}[${index}] must be a numeric string`);
      return id;
    });
  return {
    ...(raw.source === undefined ? {} : { source: raw.source }),
    huiji: parseIds(raw.huiji, "release-order.huiji"),
    kornblume: parseIds(raw.kornblume, "release-order.kornblume"),
  };
}

function sourceIndex(ids: string[], label: string): Map<string, number> {
  const index = new Map<string, number>();
  ids.forEach((id, position) => {
    if (!/^\d+$/.test(id))
      throw new Error(`${label} contains invalid ID: ${id}`);
    if (index.has(id)) throw new Error(`${label} contains duplicate ID: ${id}`);
    index.set(id, position);
  });
  return index;
}

/**
 * Roster-compatible, idempotent three-tier release ordering.
 * New CN-only entries are placed first, followed by Kornblume fallback entries,
 * then the authoritative Huiji list snapshot. Release status is intentionally
 * not consulted here.
 */
export function recalculateReleaseOrder(
  entries: CharacterEntry[],
  sources: ReleaseOrderSources,
): CharacterEntry[] {
  const huiji = sourceIndex(sources.huiji, "release-order.huiji");
  const kornblume = sourceIndex(sources.kornblume, "release-order.kornblume");
  for (const id of huiji.keys()) {
    if (kornblume.has(id))
      throw new Error(`release order ID appears in two tiers: ${id}`);
  }

  const fromHuiji: CharacterEntry[] = [];
  const fromKornblume: CharacterEntry[] = [];
  const fromAsset: CharacterEntry[] = [];
  for (const entry of entries) {
    if (huiji.has(entry.baseId)) fromHuiji.push(entry);
    else if (kornblume.has(entry.baseId)) fromKornblume.push(entry);
    else fromAsset.push(entry);
  }

  fromHuiji.sort((a, b) => huiji.get(a.baseId)! - huiji.get(b.baseId)!);
  fromKornblume.sort(
    (a, b) => kornblume.get(a.baseId)! - kornblume.get(b.baseId)!,
  );
  fromAsset.sort((a, b) => Number(a.baseId) - Number(b.baseId));

  const ordered = [...fromAsset, ...fromKornblume, ...fromHuiji];
  ordered.forEach((entry, index) => {
    entry.releaseOrder = index + 1;
  });
  return ordered;
}
