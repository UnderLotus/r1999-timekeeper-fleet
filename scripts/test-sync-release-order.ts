import assert from "node:assert/strict";
import {
  createReleaseOrderSnapshot,
  parseHuijiCards,
  synchronizeReleaseOrderFile,
  type HuijiCard,
  type KornblumeData,
  type ReleaseOrderCharacter,
} from "./sync-release-order";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function card(baseId: string, name = baseId): HuijiCard {
  return {
    id: Number(`${baseId}01`),
    baseId,
    name,
    href: `https://res1999.huijiwiki.com/wiki/${baseId}`,
  };
}

const parser = parseHuijiCards(
  JSON.stringify([card("3000", "old"), card("3001"), card("3000", "last")]),
);
assert.deepEqual(
  parser.map((entry) => [entry.baseId, entry.name]),
  [["3001", "3001"], ["3000", "last"]],
  "Huiji cards preserve order while keeping the last duplicate base ID",
);

const known: ReleaseOrderCharacter[] = Array.from({ length: 105 }, (_, index) => {
  const baseId = String(3000 + index);
  return {
    id: Number(baseId),
    name: `中文${baseId}`,
    nameEng: `fallback-${baseId}`,
  };
});
const kb: KornblumeData = {
  names: {},
  characters: [
    { Id: 42, Name: "fallback-3102", Rarity: 4 },
    { Id: 41, Name: "fallback-3103", Rarity: 5 },
  ],
};
const firstFresh = known.slice(0, 100).map((entry) => card(String(entry.id)));
const first = createReleaseOrderSnapshot(
  known,
  firstFresh,
  ["3100", "3101", "3000"],
  kb,
);
assert.deepEqual(
  first.huiji,
  [...firstFresh.map((entry) => entry.baseId), "3100", "3101"],
  "fresh Huiji order leads and absent known Huiji IDs remain in the legacy tail",
);
assert.deepEqual(first.kornblume, ["3103", "3102"]);
assert.equal(
  known.length - first.huiji.length - first.kornblume.length,
  1,
  "unmatched known IDs remain in the CN-only tier",
);

const secondFresh = known.slice(5, 105).map((entry) => card(String(entry.id)));
const second = createReleaseOrderSnapshot(known, secondFresh, first.huiji, kb);
assert.deepEqual(
  second.huiji,
  [...secondFresh.map((entry) => entry.baseId), "3000", "3001", "3002", "3003", "3004"],
  "a later Huiji cycle refreshes its leading order and carries only prior absences to the tail",
);

const temp = mkdtempSync(path.join(tmpdir(), "release-order-direct-huiji-"));
try {
  const target = path.join(temp, "release-order.json");
  const prior = JSON.stringify({ huiji: ["3000"], kornblume: [] }, null, 2) + "\n";
  writeFileSync(target, prior);
  let fallbackFetched = false;
  await assert.rejects(
    synchronizeReleaseOrderFile(
      target,
      known,
      async () => {
        throw new Error("Cloudflare challenge");
      },
      async () => {
        fallbackFetched = true;
        return kb;
      },
    ),
    /Cloudflare challenge/,
  );
  assert.equal(readFileSync(target, "utf-8"), prior, "failure must not write a KB-only snapshot");
  assert.equal(fallbackFetched, false, "KB is not used after direct Huiji failure");

  const insufficient = JSON.stringify(firstFresh.slice(0, 99));
  await assert.rejects(
    synchronizeReleaseOrderFile(
      target,
      known,
      async () => insufficient,
      async () => {
        fallbackFetched = true;
        return kb;
      },
    ),
    /only 99 known characters/,
  );
  assert.equal(readFileSync(target, "utf-8"), prior, "insufficient Huiji results leave the previous snapshot intact");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log("direct Huiji roster sync checks passed");
