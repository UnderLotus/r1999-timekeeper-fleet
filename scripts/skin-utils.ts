/** skin variant helpers（沿用 r1999-roster skin-utils.ts） */

import type { SkinEntry } from "./types";

/** 尾碼判定：1=default、2=insight、其他=skin */
export function skinTypeFromId(variantId: string): SkinEntry["type"] {
  const suffix = Number(variantId) % 100;
  if (suffix === 1) return "default";
  if (suffix === 2) return "insight";
  return "skin";
}

export interface ArcanistSkinFull {
  id: number;
  name: string;
  nameEng: string;
  des: string;
  characterSkin: string;
  characterSkinNameEng: string;
}

export interface ArcanistEntryFull {
  id: number;
  name: string;
  nameEng: string;
  live2d: ArcanistSkinFull[];
}

/** 由 ArcanistMap live2d[] 建立 skins[]（released 先預設 true，sync-fandom 再標記） */
export function buildSkins(entry: ArcanistEntryFull): SkinEntry[] {
  return entry.live2d.map((s) => ({
    id: String(s.id),
    type: skinTypeFromId(String(s.id)),
    name: s.characterSkin || undefined,
    nameEn: s.characterSkinNameEng || undefined,
    released: true,
  }));
}

/** 預設 variant（base + 01） */
export function defaultVariantId(baseId: string): string {
  return baseId + "01";
}
