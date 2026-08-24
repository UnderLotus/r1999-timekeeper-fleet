import { readFileSync } from "node:fs";
export function parseGeneratedCatalog<T>(source: string): T[] {
  const match = source.match(/=\s*(\[.*?\])\s*;?\s*$/s);
  if (!match) throw new Error("cannot parse generated catalog array");
  return JSON.parse(match[1]) as T[];
}
export function loadGeneratedCatalog<T>(file: string): T[] {
  return parseGeneratedCatalog<T>(readFileSync(file, "utf-8"));
}
