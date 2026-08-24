import { readdirSync } from "node:fs";
import path from "node:path";
export function exactAssetPaths(
  characterIds: readonly string[],
  psychubeIds: readonly string[],
): string[] {
  const validate = (id: string): string => {
    if (!/^\d+$/.test(id)) throw new Error(`Invalid asset ID: ${id}`);
    return id;
  };
  return [
    ...new Set(
      characterIds.map((id) => `singlebg/headicon_small/${validate(id)}.png`),
    ),
    ...new Set(
      psychubeIds.map((id) => `singlebg/equip_defaulticon/${validate(id)}.png`),
    ),
  ].sort();
}
export function assertExactAssetWorktree(
  root: string,
  expectedPaths: readonly string[],
): void {
  const expected = new Set(expectedPaths);
  const actual: string[] = [];
  for (const directory of [
    "singlebg/headicon_small",
    "singlebg/equip_defaulticon",
  ]) {
    const absolute = path.join(root, directory);
    for (const file of readdirSync(absolute))
      if (file.endsWith(".png")) actual.push(`${directory}/${file}`);
  }
  const unexpected = actual.filter((file) => !expected.has(file));
  const missing = expectedPaths.filter((file) => !actual.includes(file));
  if (unexpected.length || missing.length)
    throw new Error(
      `Exact asset worktree mismatch; unexpected=${unexpected.slice(0, 5).join(",")}; missing=${missing.slice(0, 5).join(",")}`,
    );
}
