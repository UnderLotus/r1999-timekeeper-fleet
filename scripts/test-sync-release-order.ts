import assert from "node:assert/strict";
import { UpstreamRefreshError } from "./sync-refresh";
import {
  buildVariantOwnershipMap,
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
const mappedVariants = parseHuijiCards(
  JSON.stringify([
    { id: 30660001, baseId: "306600", name: "37 past", href: "https://res1999.huijiwiki.com/wiki/30660001" },
    { id: 30880001, name: "Semmelweis past", href: "https://res1999.huijiwiki.com/wiki/30880001" },
  ]),
  buildVariantOwnershipMap([
    {
      id: 3066,
      name: "37",
      nameEng: "Thirty-seven",
      live2d: [
        {
          id: 30660001,
          name: "",
          nameEng: "",
          des: "",
          characterSkin: "",
          characterSkinNameEng: "",
        },
      ],
    },
    {
      id: 3088,
      name: "Semmelweis",
      nameEng: "Semmelweis",
      live2d: [
        {
          id: 30880001,
          name: "",
          nameEng: "",
          des: "",
          characterSkin: "",
          characterSkinNameEng: "",
        },
      ],
    },
  ]),
);
assert.deepEqual(
  mappedVariants.map((entry) => entry.baseId),
  ["3066", "3088"],
  "current ArcanistMap ownership wins over Variant width and supplied baseId",
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
  const failedRemote = await synchronizeReleaseOrderFile(
    target,
    known,
    async () => {
      throw new UpstreamRefreshError("Cloudflare challenge");
    },
    async () => {
      fallbackFetched = true;
      return kb;
    },
  );
  assert.deepEqual(failedRemote, { huiji: ["3000"], kornblume: [] });
  assert.equal(readFileSync(target, "utf-8"), prior, "failure must not write a KB-only snapshot");
  assert.equal(fallbackFetched, false, "KB is not used after direct Huiji failure");

  const insufficient = JSON.stringify(firstFresh.slice(0, 99));
  const failedCoverage = await synchronizeReleaseOrderFile(
    target,
    known,
    async () => insufficient,
    async () => {
      fallbackFetched = true;
      return kb;
    },
  );
  assert.deepEqual(failedCoverage, { huiji: ["3000"], kornblume: [] });
  assert.equal(readFileSync(target, "utf-8"), prior, "insufficient Huiji results leave the previous snapshot intact");

  await assert.rejects(
    () =>
      synchronizeReleaseOrderFile(
        target,
        known,
        async () => {
          throw new Error("programming failure");
        },
        async () => kb,
      ),
    /programming failure/,
    "arbitrary Huiji callback errors remain fatal",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log("direct Huiji roster sync checks passed");
