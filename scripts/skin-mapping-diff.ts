/** Diff CN package skins against the ArcanistMap listing used to build the catalog. */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PackageSkin } from "./catalog-composition";
import type { ArcanistEntryFull } from "./skin-utils";

export const DEFAULT_MAPPING_DIFF_FILE = path.join(
  "/tmp/r1999-team-list-sync",
  "skin-mapping-diff.json",
);

/**
 * Per-run diff path. A sync run generates its own file name so the end-of-run
 * summary can never mistake a stale diff from an earlier run for the current
 * one, even when this run's persistence fails.
 */
export function mappingDiffFile(): string {
  const override = process.env.R1999_MAPPING_DIFF_FILE;
  return override && override.trim() ? override : DEFAULT_MAPPING_DIFF_FILE;
}

export interface UnmappedCnSkin {
  id: string;
  baseId: string;
  name: string;
}

/**
 * Report CN package skins that belong to a known character but never appear in
 * that character's live2d list. The upstream mapping file can lag behind the
 * game package, which would silently drop garments from the catalog snapshot.
 * Skins of unknown bases are ignored: they either belong to excluded entries
 * or to characters the catalog does not track yet.
 */
export function computeUnmappedCnSkins(
  cnSkins: PackageSkin[],
  arcanists: ArcanistEntryFull[],
  ignoredIds: ReadonlySet<string> = new Set(),
): UnmappedCnSkin[] {
  const mapped = new Set(
    arcanists.flatMap((entry) => entry.live2d.map((skin) => String(skin.id))),
  );
  for (const id of ignoredIds) mapped.add(id);
  const names = new Map(
    arcanists.map((entry) => [String(entry.id), entry.name]),
  );
  const unmapped = new Map<string, UnmappedCnSkin>();
  for (const skin of cnSkins) {
    const id = String(skin.id);
    if (id.length < 3 || mapped.has(id)) continue;
    const baseId = id.slice(0, -2);
    const name = names.get(baseId);
    if (!name) continue;
    unmapped.set(id, { id, baseId, name });
  }
  return [...unmapped.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Persist the diff for the end-of-sync summary. Returns false when the file
 * cannot be written; this is best-effort and must never throw.
 */
export function persistMappingDiff(
  diff: readonly UnmappedCnSkin[],
  detailFile: string,
): boolean {
  try {
    mkdirSync(path.dirname(detailFile), { recursive: true });
    writeFileSync(
      detailFile,
      JSON.stringify({ generatedAt: new Date().toISOString(), diff }, null, 2) +
        "\n",
    );
    return true;
  } catch {
    return false;
  }
}

/** Log a non-blocking reminder; the pipeline continues and must not fail. */
export function reportUnmappedCnSkins(
  diff: readonly UnmappedCnSkin[],
  detailFile: string | null,
): void {
  if (diff.length === 0) return;
  console.log(
    `提醒：CN 包體有 ${diff.length} 個衣著未出現在 ArcanistMap 對照表，catalog 未收錄：`,
  );
  for (const entry of diff)
    console.log(`  - ${entry.id}（${entry.name}）`);
  if (detailFile) console.log(`  完整清單：${detailFile}`);
  else console.log("  （差異清單暫存失敗，僅本次輸出可讀）");
  console.log("  僅提醒不中斷；請人工確認是否需要更新對照表或收錄衣著。");
}
