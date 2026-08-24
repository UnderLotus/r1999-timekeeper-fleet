/** 靜態目錄資料型別（由 scripts/build-names.ts / build-psychubes.ts 產生，見 docs/DESIGN.md） */

export type InsightIndex = 0 | 1 | 2 | 3;

export type SkinType = "default" | "insight" | "skin";

export interface SkinVariant {
  /** 6 位 headicon id，如 300301 */
  id: string;
  type: SkinType;
  /** 本地化 skin 名稱（zh；若有可信來源） */
  name?: string;
  nameEn?: string;
  /** 未來視：false = 未實裝（GL 解包為 checkpoint，活動上下半手動校正） */
  released: boolean;
}

export type LangCode = "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR";

export interface CharacterDef {
  /** 5 位角色 id，如 3003（ArcanistMap 頂層 id） */
  id: string;
  baseId: string;
  names: Record<LangCode, string>;
  /** 2-4★ = 2，5★/6★ = 3；無可信 rarity 時保守給 2 */
  maxInsight: InsightIndex;
  rarity: number | null;
  releaseOrder: number;
  /** 未來視：角色層是否海外服已實裝 */
  released: boolean;
  skins: SkinVariant[];
  defaultVariant: string;
  /** 可裝備心相欄數；缺省為 1。 */
  psychubeSlots?: 1 | 2;
  /** 官方推薦／專屬心相，供特殊欄位提示與未來擴充。 */
  exclusivePsychubeIds?: string[];
}

export interface PsychubeDef {
  /** 4 位 id，如 1000 */
  id: string;
  /** 5 語系名稱 */
  names: Record<LangCode, string>;
  rarity: number | null;
  released: boolean;
}
