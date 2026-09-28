/** Skin Variant helpers. Ownership comes from the parent ArcanistMap entry. */

import type { SkinEntry } from "./types";

const INITIAL_DESCRIPTION = "初始皮肤";
const INSIGHT_DESCRIPTION = "进阶皮肤";

export interface ArcanistSkinFull {
  id: number | string;
  name: string;
  nameEng: string;
  des: string;
  characterSkin: string;
  characterSkinNameEng: string;
}

export interface ArcanistEntryFull {
  id: number | string;
  name: string;
  nameEng: string;
  live2d: ArcanistSkinFull[];
}

/** Classify a Variant using metadata first, then exact legacy IDs. */
export function skinTypeFromId(
  baseId: string,
  variant: Pick<ArcanistSkinFull, "id" | "des">,
): SkinEntry["type"] {
  const variantId = String(variant.id);
  if (variant.des === INITIAL_DESCRIPTION) return "default";
  if (variant.des === INSIGHT_DESCRIPTION) return "insight";
  if (variantId === `${baseId}01`) return "default";
  if (variantId === `${baseId}02`) return "insight";
  return "skin";
}

/** Build owned Skins from the parent ArcanistMap live2d list. */
export function buildSkins(entry: ArcanistEntryFull): SkinEntry[] {
  const baseId = String(entry.id);
  return entry.live2d.map((skin) => ({
    id: String(skin.id),
    type: skinTypeFromId(baseId, skin),
    name: skin.characterSkin || undefined,
    nameEn: skin.characterSkinNameEng || undefined,
    released: true,
  }));
}

/** Legacy default Variant ID used when no classified mapping overrides it. */
export function defaultVariantId(baseId: string): string {
  return baseId + "01";
}
