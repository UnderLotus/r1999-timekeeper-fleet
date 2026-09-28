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
import { fileURLToPath } from "node:url";
import { synchronizeCnDirectory } from "./sync-cn-data";
import { synchronizeGlDirectory } from "./sync-gl-data";
import {
  Arcanist,
  synchronizeNameFallbackFile,
  type NameFallbackRow,
} from "./sync-name-fallbacks";
import { UpstreamRefreshError } from "./sync-refresh";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = mkdtempSync(path.join(tmpdir(), "r1999-sync-fallbacks-"));

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
  const glData = path.join(root, "gl-data");
  copyFixture(path.join(ROOT, "scripts/data/gl"), path.join(glData, "gl"));
  const priorGlCharacter = readFileSync(path.join(glData, "gl/character.json"));
  await synchronizeGlDirectory(
    glData,
    fixtureFetch(path.join(ROOT, "scripts/data/gl"), "invalid-json"),
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
        fixtureFetch(path.join(ROOT, "scripts/data/gl"), "upstream"),
      ),
    /GL data missing.*character\.json/,
    "GL upstream failure without prior input is fatal",
  );
  await assert.rejects(
    () =>
      synchronizeGlDirectory(
        glData,
        fixtureFetch(path.join(ROOT, "scripts/data/gl"), "programming"),
      ),
    /fixture programming failure/,
    "GL arbitrary callback errors are not classified as remote",
  );
  const invalidGlData = path.join(root, "invalid-gl-data");
  copyFixture(path.join(ROOT, "scripts/data/gl"), path.join(invalidGlData, "gl"));
  writeFileSync(path.join(invalidGlData, "gl/character.json"), "[]");
  await assert.rejects(
    () =>
      synchronizeGlDirectory(
        invalidGlData,
        fixtureFetch(path.join(ROOT, "scripts/data/gl"), "upstream"),
      ),
    /minimum\/sentinel/,
    "GL invalid prior input is fatal",
  );

  const cnData = path.join(root, "cn-data");
  copyFixture(path.join(ROOT, "scripts/data/cn"), path.join(cnData, "cn"));
  const priorCnCharacter = readFileSync(path.join(cnData, "cn/character.json"));
  await synchronizeCnDirectory(
    cnData,
    fixtureFetch(path.join(ROOT, "scripts/data/cn"), "upstream"),
  );
  assert.deepEqual(
    readFileSync(path.join(cnData, "cn/character.json")),
    priorCnCharacter,
    "CN remote failure reuses the validated prior file",
  );
  await assert.rejects(
    () =>
      synchronizeCnDirectory(
        path.join(root, "missing-cn"),
        fixtureFetch(path.join(ROOT, "scripts/data/cn"), "upstream"),
      ),
    /CN data missing.*character\.json/,
    "CN upstream failure without prior input is fatal",
  );
  const invalidCnData = path.join(root, "invalid-cn-data");
  copyFixture(path.join(ROOT, "scripts/data/cn"), path.join(invalidCnData, "cn"));
  writeFileSync(path.join(invalidCnData, "cn/character.json"), "[]");
  await assert.rejects(
    () =>
      synchronizeCnDirectory(
        invalidCnData,
        fixtureFetch(path.join(ROOT, "scripts/data/cn"), "upstream"),
      ),
    /minimum\/sentinel/,
    "CN invalid prior input is fatal",
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
  await assert.rejects(
    () =>
      synchronizeNameFallbackFile(
        path.join(root, "missing-names.json"),
        arcanists,
        async () => {
          throw new UpstreamRefreshError("fixture names outage");
        },
      ),
    /Cannot reuse name-fallbacks\.json/,
    "names upstream failure without prior input is fatal",
  );
  await assert.rejects(
    () =>
      synchronizeNameFallbackFile(namesFile, arcanists, async () => {
        throw new Error("fixture programming failure");
      }),
    /fixture programming failure/,
    "names arbitrary callback errors are not classified as remote",
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
