import type { CharacterDef, PsychubeDef } from "../../src/types/catalog";
import { setCatalogForTesting } from "../../src/utils/catalog";

/**
 * Deterministic runtime catalog fixtures using the catalog's real 0-based
 * rarity scale (`5` = 6★, `4` = 5★, `3` = 4★, `2` = 3★, `1` = 2★).
 */
export const fixtureCharacters: readonly CharacterDef[] = [
  {
    id: "3003",
    baseId: "3003",
    names: {
      "zh-CN": "槲寄生",
      "zh-TW": "槲寄生",
      "en-US": "Mistletoe",
      "ja-JP": "ミストルティン",
      "ko-KR": "미슬토",
    },
    maxInsight: 3,
    rarity: 5,
    releaseOrder: 1,
    released: true,
    defaultVariant: "300301",
    skins: [
      { id: "300301", type: "default", released: true },
      { id: "300302", type: "insight", released: true },
      { id: "300303", type: "skin", released: false },
    ],
  },
  {
    id: "3004",
    baseId: "3004",
    names: {
      "zh-CN": "十四行诗",
      "zh-TW": "十四行詩",
      "en-US": "Sonetto",
      "ja-JP": "ソネット",
      "ko-KR": "소네토",
    },
    maxInsight: 2,
    rarity: 4,
    releaseOrder: 2,
    released: true,
    defaultVariant: "300401",
    skins: [{ id: "300401", type: "default", released: true }],
  },
  {
    id: "3005",
    baseId: "3005",
    names: {
      "zh-CN": "未来角色",
      "zh-TW": "未來角色",
      "en-US": "Future Character",
      "ja-JP": "未来キャラ",
      "ko-KR": "미래 캐릭터",
    },
    maxInsight: 3,
    rarity: 5,
    releaseOrder: 0,
    released: false,
    defaultVariant: "300501",
    skins: [{ id: "300501", type: "default", released: true }],
  },
  {
    id: "3149",
    baseId: "3149",
    names: {
      "zh-CN": "双生舞伶",
      "zh-TW": "雙生舞伶",
      "en-US": "The Twins",
      "ja-JP": "双子",
      "ko-KR": "쌍둥이",
    },
    maxInsight: 3,
    rarity: 4,
    releaseOrder: 3,
    released: true,
    defaultVariant: "314901",
    skins: [{ id: "314901", type: "default", released: true }],
    psychubeSlots: 2,
    exclusivePsychubeIds: ["1571", "1572"],
  },
];

export const fixturePsychubes: readonly PsychubeDef[] = [
  {
    id: "1000",
    names: {
      "zh-CN": "必要的记录",
      "zh-TW": "必要的紀錄",
      "en-US": "Necessary Records",
      "ja-JP": "必要の記録",
      "ko-KR": "필요한 기록",
    },
    rarity: 5,
    released: true,
  },
  {
    id: "1001",
    names: {
      "zh-CN": "欢愉",
      "zh-TW": "歡愉",
      "en-US": "Joy",
      "ja-JP": "歓喜",
      "ko-KR": "환희",
    },
    rarity: 4,
    released: true,
  },
  {
    id: "1571",
    names: {
      "zh-CN": "艺术原子能",
      "zh-TW": "藝術原子能",
      "en-US": "The Art of Atoms",
      "ja-JP": "原子の芸術",
      "ko-KR": "예술 원자력",
    },
    rarity: 4,
    released: true,
  },
  {
    id: "1572",
    names: {
      "zh-CN": "科学编舞法",
      "zh-TW": "科學編舞法",
      "en-US": "The Dance of Science",
      "ja-JP": "科学の振付",
      "ko-KR": "과학 안무법",
    },
    rarity: 4,
    released: true,
  },
  {
    id: "1002",
    names: {
      "zh-CN": "未来心相",
      "zh-TW": "未來心相",
      "en-US": "Future Psychube",
      "ja-JP": "未来の心相",
      "ko-KR": "미래 의지",
    },
    rarity: 5,
    released: false,
  },
];

export const CHAR_MISTLETOE = fixtureCharacters[0];
export const CHAR_SONETTO = fixtureCharacters[1];
export const CHAR_FUTURE = fixtureCharacters[2];
export const CHAR_TWINS = fixtureCharacters[3];

export const PSY_NECESSARY = fixturePsychubes[0];
export const PSY_JOY = fixturePsychubes[1];
export const PSY_ART = fixturePsychubes[2];
export const PSY_SCIENCE = fixturePsychubes[3];
export const PSY_FUTURE = fixturePsychubes[4];

/** Temporarily override the runtime catalog and restore the fixture catalog afterwards. */
export function withTestCatalog<T>(
  characters: readonly CharacterDef[],
  psychubes: readonly PsychubeDef[],
  run: () => T,
): T {
  setCatalogForTesting(characters, psychubes);
  try {
    return run();
  } finally {
    setCatalogForTesting(fixtureCharacters, fixturePsychubes);
  }
}
