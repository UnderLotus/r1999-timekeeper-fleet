import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CharacterEntry, PsychubeEntry, SkinEntry } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_SOURCE_FILE = path.join(
  __dirname,
  "data/catalog-source.json",
);
type SourceSkinBase = Omit<SkinEntry, "released" | "type">;
export type SourceSkin = SourceSkinBase &
  ({ type: "default" | "insight" } | { type: "skin"; glPresent: boolean });
export interface SourceCharacter
  extends Omit<CharacterEntry, "releaseOrder" | "released" | "skins"> {
  glReleased: boolean;
  skins: SourceSkin[];
}
export interface SourcePsychube extends Omit<PsychubeEntry, "released"> {
  glPresent: boolean;
}
export interface CatalogSourceSnapshot {
  schemaVersion: 3;
  sourceHashes: Record<string, string>;
  characters: SourceCharacter[];
  psychubes: SourcePsychube[];
}
export function loadCatalogSource(): CatalogSourceSnapshot {
  const snapshot = JSON.parse(
    readFileSync(CATALOG_SOURCE_FILE, "utf-8"),
  ) as CatalogSourceSnapshot;
  if (
    snapshot.schemaVersion !== 3 ||
    !Array.isArray(snapshot.characters) ||
    !Array.isArray(snapshot.psychubes) ||
    snapshot.characters.some(
      (character) =>
        !Array.isArray(character.skins) ||
        character.skins.some(
          (skin) => skin.type === "skin" && typeof skin.glPresent !== "boolean",
        ),
    )
  )
    throw new Error("Invalid catalog-source.json; run npm run build:source");
  return snapshot;
}
