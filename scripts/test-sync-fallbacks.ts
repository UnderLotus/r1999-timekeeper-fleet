import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { synchronizeCnDirectory } from "./sync-cn-data";
import { synchronizeGlDirectory } from "./sync-gl-data";
import {
  Arcanist,
  synchronizeNameFallbackFile,
  type NameFallbackRow,
} from "./sync-name-fallbacks";
import { UpstreamRefreshError } from "./sync-refresh";

const root = mkdtempSync(path.join(tmpdir(), "r1999-sync-fallbacks-"));

function numberedRows(
  count: number,
  sentinel: number,
  origin: string,
): Array<{ id: number; origin: string }> {
  return Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? sentinel : sentinel + index,
    origin,
  }));
}

function languageRows(count: number): Array<{ key: string; content: string }> {
  return Array.from({ length: count }, (_, index) => ({
    key: `fixture-key-${index}`,
    content: `fixture content ${index}`,
  }));
}

function writeFixture(directory: string, name: string, value: unknown[]): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, name), JSON.stringify(value));
}

function makeGlFixture(directory: string, origin: string): string {
  writeFixture(directory, "character.json", numberedRows(100, 3003, origin));
  writeFixture(directory, "equip.json", numberedRows(100, 1201, origin));
  writeFixture(directory, "skin.json", numberedRows(300, 300301, origin));
  for (const name of [
    "language_zh.json",
    "language_tw.json",
    "language_jp.json",
    "language_kr.json",
    "language_en.json",
  ])
    writeFixture(directory, name, languageRows(10_000));
  return directory;
}

function makeCnFixture(directory: string, origin: string): string {
  writeFixture(directory, "ArcanistMap.json", numberedRows(100, 3003, origin));
  writeFixture(directory, "character.json", numberedRows(100, 3003, origin));
  writeFixture(directory, "equip.json", numberedRows(100, 1201, origin));
  writeFixture(directory, "skin.json", numberedRows(300, 300301, origin));
  return directory;
}

function copyFixture(sourceDir: string, output: string): void {
  mkdirSync(path.dirname(output), { recursive: true });
  cpSync(sourceDir, output, { recursive: true });
}

function fixtureFetch(sourceDir: string, mode: "upstream" | "invalid-json" | "programming") {
  return (url: string, output: string): void => {
    const name = url.split("/").pop()!;
    if (mode === "programming") throw new Error("fixture programming failure");
    if (name === "character.json" && mode === "upstream")
      throw new UpstreamRefreshError("fixture remote outage");
    if (name === "character.json" && mode === "invalid-json") {
      writeFileSync(output, "not-json");
      return;
    }
    copyFixture(path.join(sourceDir, name), output);
  };
}

try {
  const glFixture = makeGlFixture(path.join(root, "gl-fixture"), "fresh");
  const cnFixture = makeCnFixture(path.join(root, "cn-fixture"), "fresh");
  const glData = path.join(root, "gl-data");
  copyFixture(
    makeGlFixture(path.join(root, "gl-prior"), "prior"),
    path.join(glData, "gl"),
  );
  const priorGlCharacter = readFileSync(path.join(glData, "gl/character.json"));
  await synchronizeGlDirectory(
    glData,
    fixtureFetch(glFixture, "invalid-json"),
  );
  assert.deepEqual(
    readFileSync(path.join(glData, "gl/equip.json")),
    readFileSync(path.join(glFixture, "equip.json")),
    "GL refresh installs the freshly validated upstream files",
  );
  assert.deepEqual(
    readFileSync(path.join(glData, "gl/character.json")),
    priorGlCharacter,
    "GL invalid remote JSON reuses the validated prior file",
  );
  await assert.rejects(
    () =>
      synchronizeGlDirectory(
        path.join(root, "missing-gl"),
        fixtureFetch(glFixture, "upstream"),
      ),
    /GL data missing/,
    "GL upstream failure without prior input is fatal",
  );
  await assert.rejects(
    () =>
      synchronizeGlDirectory(
        glData,
        fixtureFetch(glFixture, "programming"),
      ),
    /fixture programming failure/,
    "arbitrary callback errors are not classified as remote",
  );
  const invalidGlData = path.join(root, "invalid-gl-data");
  copyFixture(glFixture, path.join(invalidGlData, "gl"));
  writeFileSync(path.join(invalidGlData, "gl/character.json"), "[]");
  await assert.rejects(
    () =>
      synchronizeGlDirectory(
        invalidGlData,
        fixtureFetch(glFixture, "upstream"),
      ),
    /minimum\/sentinel/,
    "GL invalid prior input is fatal",
  );

  const cnData = path.join(root, "cn-data");
  copyFixture(
    makeCnFixture(path.join(root, "cn-prior"), "prior"),
    path.join(cnData, "cn"),
  );
  const priorCnCharacter = readFileSync(path.join(cnData, "cn/character.json"));
  await synchronizeCnDirectory(
    cnData,
    fixtureFetch(cnFixture, "upstream"),
  );
  assert.deepEqual(
    readFileSync(path.join(cnData, "cn/equip.json")),
    readFileSync(path.join(cnFixture, "equip.json")),
    "CN refresh installs the freshly validated upstream files",
  );
  assert.deepEqual(
    readFileSync(path.join(cnData, "cn/character.json")),
    priorCnCharacter,
    "CN remote failure reuses the validated prior file",
  );

  const arcanists: Arcanist[] = Array.from({ length: 100 }, (_, index) => ({
    id: 3000 + index,
    name: `CN ${index}`,
    nameEng: `Character ${index}`,
  }));
  const rows: NameFallbackRow[] = arcanists.map((entry) => ({
    baseId: String(entry.id),
    names: { "en-US": entry.nameEng },
  }));
  const namesFile = path.join(root, "name-fallbacks.json");
  writeFileSync(namesFile, JSON.stringify({ schemaVersion: 1, rows }, null, 2) + "\n");
  const priorNames = readFileSync(namesFile);
  await synchronizeNameFallbackFile(
    namesFile,
    arcanists,
    async () => {
      throw new UpstreamRefreshError("fixture names outage");
    },
  );
  assert.deepEqual(
    readFileSync(namesFile),
    priorNames,
    "names remote failure retains the validated prior snapshot",
  );
  const invalidNamesFile = path.join(root, "invalid-name-fallbacks.json");
  writeFileSync(invalidNamesFile, JSON.stringify({ schemaVersion: 1, rows: [] }));
  await assert.rejects(
    () =>
      synchronizeNameFallbackFile(invalidNamesFile, arcanists, async () => {
        throw new UpstreamRefreshError("fixture names outage");
      }),
    /Invalid\/truncated name-fallbacks/,
    "names invalid prior input is fatal",
  );

  console.log("sync refresh fallback tests: passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
