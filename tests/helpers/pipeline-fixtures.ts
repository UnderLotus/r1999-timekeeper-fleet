import sharp from "sharp";
import type { CatalogLanguageTables } from "../../scripts/catalog-composition";
import type { CatalogPolicy } from "../../scripts/catalog-policy";
import type { ArcanistEntryFull, ArcanistSkinFull } from "../../scripts/skin-utils";

export function makeEmptyLanguages(): CatalogLanguageTables {
  return {
    "zh-CN": {},
    "zh-TW": {},
    "en-US": {},
    "ja-JP": {},
    "ko-KR": {},
  };
}

export function makeEmptyPolicy(): CatalogPolicy {
  return {
    excludedCharacters: [],
    excludedPsychubes: [],
    characterCapabilities: [],
    preservedCharacterAssets: [],
    ignoredCnSkinStubs: [],
  };
}

export function makeArcanistSkin(
  id: number | string,
  overrides: Partial<ArcanistSkinFull> = {},
): ArcanistSkinFull {
  return {
    id,
    name: "",
    nameEng: "",
    des: "",
    characterSkin: "",
    characterSkinNameEng: "",
    ...overrides,
  };
}

export function makeArcanist(
  id: number,
  name: string,
  nameEng: string,
  variants: readonly (number | string | ArcanistSkinFull)[],
): ArcanistEntryFull {
  return {
    id,
    name,
    nameEng,
    live2d: variants.map((variant) =>
      typeof variant === "object"
        ? variant
        : makeArcanistSkin(variant, {
            name: `CN skin ${variant}`,
            nameEng: `Skin ${variant}`,
            characterSkin: `CN skin ${variant}`,
            characterSkinNameEng: `Skin ${variant}`,
          }),
    ),
  };
}

export async function writeTestPng(
  file: string,
  width: number,
  height: number,
  alpha = 1,
): Promise<void> {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 32, g: 64, b: 96, alpha },
    },
  })
    .png()
    .toFile(file);
}

export async function writeTestWebp(
  file: string,
  width: number,
  height: number,
  options: { alpha?: number; lossless?: boolean } = {},
): Promise<void> {
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: options.alpha ?? 1 },
    },
  })
    .webp(options.lossless === false ? { quality: 80 } : { lossless: true })
    .toFile(file);
}
