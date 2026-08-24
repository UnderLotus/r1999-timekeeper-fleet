/** 管線共用型別（mirror src/types/catalog.ts + 管線專用欄位） */

export interface SkinEntry {
  id: string;
  type: "default" | "insight" | "skin";
  name?: string;
  nameEn?: string;
  released: boolean;
}

export interface CharacterEntry {
  id: string;
  baseId: string;
  names: Record<"zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR", string>;
  rarity: number | null;
  maxInsight: number;
  releaseOrder: number;
  released: boolean;
  skins: SkinEntry[];
  defaultVariant: string;
  psychubeSlots?: 1 | 2;
  exclusivePsychubeIds?: string[];
}

export interface PsychubeEntry {
  id: string;
  names: Record<"zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR", string>;
  rarity: number | null;
  released: boolean;
}

export interface PendingEntry {
  baseId: string;
  variantId: string;
  name: string;
  nameEn: string;
  reason: string;
}
