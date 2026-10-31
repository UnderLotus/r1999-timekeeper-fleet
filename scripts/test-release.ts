import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { characters } from "../src/data/characters";
import { loadCatalogSource } from "./catalog-source";
import { psychubes } from "../src/data/psychubes";
import {
  assertKnownOverrides,
  parseReleaseOverrides,
  indexReleaseOverrides,
  resolveCharacterRelease,
  resolveGlobalIsOnline,
  resolvePsychubeRelease,
  resolveSkinRelease,
  uniqueOverrides,
} from "./release-status";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0,
  fail = 0;
function check(name: string, value: boolean, detail = ""): void {
  if (value) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function throws(run: () => void): boolean {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}
function json<T>(relative: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, relative), "utf-8")) as T;
}
const releaseClock = new Date("2026-09-03T10:00:00.000Z");
const globalUtcOffsetMinutes = -5 * 60;
const globalIsOnlineFixtures: readonly [string, unknown, boolean][] = [
  ["numeric 1", 1, true],
  ["string 1", "1", true],
  ["numeric 0", 0, false],
  ["string 0", "0", false],
  ["empty", "", false],
  ["null", null, false],
  ["missing", undefined, false],
  ["past timestamp", "2026-09-03 04:59:59", true],
  ["future timestamp", "2026-09-03 05:00:01", false],
  ["equal timestamp", "2026-09-03 05:00:00", false],
];
for (const [label, value, expected] of globalIsOnlineFixtures)
  check(
    `isOnline ${label}`,
    resolveGlobalIsOnline(value, releaseClock, globalUtcOffsetMinutes) === expected,
  );
check(
  "server-local timestamp conversion uses the explicit region offset",
  resolveGlobalIsOnline(
    "2026-09-03 04:59:59",
    new Date("2026-09-03T09:59:59.000Z"),
    globalUtcOffsetMinutes,
  ) === false &&
    resolveGlobalIsOnline(
      "2026-09-03 04:59:59",
      new Date("2026-09-03T10:00:00.000Z"),
      globalUtcOffsetMinutes,
    ) === true,
);
check(
  "unknown string isOnline fails loudly",
  throws(() => resolveGlobalIsOnline("2", releaseClock, globalUtcOffsetMinutes)),
);
check(
  "unknown numeric isOnline fails loudly",
  throws(() => resolveGlobalIsOnline(2, releaseClock, globalUtcOffsetMinutes)),
);
check(
  "non-Global timestamp syntax fails loudly",
  throws(() => resolveGlobalIsOnline("2026-09-03T05:00:00Z", releaseClock, globalUtcOffsetMinutes)),
);
check(
  "invalid Global timestamp calendar date fails loudly",
  throws(() => resolveGlobalIsOnline("2026-02-30 05:00:00", releaseClock, globalUtcOffsetMinutes)),
);
check(
  "invalid release clock fails loudly",
  throws(() => resolveGlobalIsOnline("2026-09-03 04:59:59", new Date(NaN), globalUtcOffsetMinutes)),
);
check(
  "manual false overrides released character",
  !resolveCharacterRelease(true, false),
);
check(
  "manual true overrides unreleased character",
  resolveCharacterRelease(false, true),
);
check(
  "default and insight variants bypass the garment release gate",
  resolveSkinRelease("default", false, false) &&
    resolveSkinRelease("insight", undefined, false),
);
check(
  "garment release follows Global skin.json presence",
  resolveSkinRelease("skin", true) && !resolveSkinRelease("skin", false),
);
check(
  "garment manual override wins over Global presence",
  resolveSkinRelease("skin", false, true) &&
    !resolveSkinRelease("skin", true, false),
);
check(
  "garment without a Global presence checkpoint fails loudly",
  throws(() => resolveSkinRelease("skin", undefined)),
);
check("GL-present psychube is released", resolvePsychubeRelease(true));
check("CN-only psychube is unreleased", !resolvePsychubeRelease(false));
check(
  "legacy map override schema is rejected",
  throws(() => parseReleaseOverrides({ "3147": false })),
);
const parsed = parseReleaseOverrides({
  characters: [{ baseId: 1, isReleased: false, note: "gate" }],
  skins: [{ variantId: "101", isReleased: true }],
  psychubes: [{ id: "1001", isReleased: false }],
});
check(
  "unified override schema parses all entity kinds",
  parsed.characters.length === 1 &&
    parsed.skins.length === 1 &&
    parsed.psychubes.length === 1,
);
check(
  "duplicate overrides fail loudly",
  throws(() =>
    uniqueOverrides([{ id: "1" }, { id: "1" }], (entry) => entry.id, "fixture"),
  ),
);
check(
  "stale overrides fail loudly",
  throws(() =>
    assertKnownOverrides(new Map([["2", true]]), new Set(["1"]), "fixture"),
  ),
);
const overrides = parseReleaseOverrides(
  json("scripts/data/released-overrides.json"),
);
const source = loadCatalogSource();
const index = indexReleaseOverrides(overrides, {
  characters: new Set(source.characters.map((entry) => entry.baseId)),
  skins: new Set(
    source.characters.flatMap((entry) =>
      entry.skins.filter((skin) => skin.type === "skin").map((skin) => skin.id),
    ),
  ),
  psychubes: new Set(source.psychubes.map((entry) => entry.id)),
});
const autoReleasedCharacters = new Set(
  source.characters
    .filter((entry) => entry.glReleased)
    .map((entry) => entry.baseId),
);
const glPsychubes = new Set(
  source.psychubes.filter((entry) => entry.glPresent).map((entry) => entry.id),
);
const badCharacters = characters
  .filter(
    (character) =>
      character.released !==
      (index.characters.get(character.baseId)?.isReleased ??
        autoReleasedCharacters.has(character.baseId)),
  )
  .map((character) => character.baseId);
const sourceSkins = new Map(
  source.characters.flatMap((character) =>
    character.skins.map((skin) => [skin.id, skin] as const),
  ),
);
const badSkins = characters
  .flatMap((character) => character.skins)
  .filter((skin) => {
    const sourceSkin = sourceSkins.get(skin.id);
    if (!sourceSkin) return true;
    return (
      skin.released !==
      resolveSkinRelease(
        sourceSkin.type,
        sourceSkin.type === "skin" ? sourceSkin.glPresent : undefined,
        index.skins.get(skin.id)?.isReleased,
      )
    );
  })
  .map((skin) => skin.id);
const badPsychubes = psychubes
  .filter(
    (psychube) =>
      psychube.released !==
      (index.psychubes.get(psychube.id)?.isReleased ??
        glPsychubes.has(psychube.id)),
  )
  .map((psychube) => psychube.id);
check(
  "all character releases match GL isOnline then override",
  badCharacters.length === 0,
  badCharacters.join(","),
);
check(
  "all skin releases match type-specific GL presence then override",
  badSkins.length === 0,
  badSkins.join(","),
);
check(
  "all psychube releases match CN∩GL then override",
  badPsychubes.length === 0,
  badPsychubes.join(","),
);
const sonettoGuidebookSkin = characters
    .find((entry) => entry.baseId === "3023")
    ?.skins.find((skin) => skin.id === "302306"),
  sonettoGuidebookSource = sourceSkins.get("302306");
check(
  "CN artbook-exclusive Sonetto garment stays unreleased on Global",
  sonettoGuidebookSource?.type === "skin" &&
    sonettoGuidebookSource.glPresent === true &&
    index.skins.get("302306")?.isReleased === false &&
    sonettoGuidebookSkin?.released === false,
);
console.log(`\nrelease tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
