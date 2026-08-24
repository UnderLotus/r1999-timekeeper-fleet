/** Vite/GitHub Pages-safe 資產路徑 helper（沿用 r1999-roster assets.ts 概念） */

export function characterAssetPath(variantId: string): string {
  return `/assets/characters/${variantId}.webp`;
}

export function psychubeAssetPath(id: string): string {
  return `/assets/psychubes/${id}.webp`;
}

/** 加上 BASE_URL 前綴（GitHub Pages 子路徑部署用） */
export function prefixed(path: string): string {
  return (import.meta.env?.BASE_URL ?? "/") + path.replace(/^\//, "");
}

export function assetSrc(path: string): string {
  return prefixed(path);
}
