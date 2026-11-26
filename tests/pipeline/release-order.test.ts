import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  parseReleaseOrderSources,
  recalculateReleaseOrder,
} from "../../scripts/recalculate-order";
import { UpstreamRefreshError } from "../../scripts/sync-refresh";
import {
  buildVariantOwnershipMap,
  createReleaseOrderSnapshot,
  parseHuijiCards,
  synchronizeReleaseOrderFile,
  type HuijiCard,
  type KornblumeData,
  type ReleaseOrderCharacter,
} from "../../scripts/sync-release-order";
import type { CharacterEntry } from "../../scripts/types";
import { makeArcanist, makeArcanistSkin } from "../helpers/pipeline-fixtures";

function card(baseId: string, name = baseId): HuijiCard {
  return {
    id: Number(`${baseId}01`),
    baseId,
    name,
    href: `https://res1999.huijiwiki.com/wiki/${baseId}`,
  };
}

function makeCharacterEntry(baseId: string): CharacterEntry {
  return {
    id: baseId,
    baseId,
    names: { "zh-CN": `角色${baseId}` },
    rarity: 5,
    maxInsight: 3,
    releaseOrder: 0,
    released: true,
    defaultVariant: `${baseId}01`,
    skins: [{ id: `${baseId}01`, type: "default", released: true }],
  };
}

describe("release order parsing, snapshotting, and recalculation", () => {
  it("dedupes Huiji cards keeping the last occurrence and prioritizes ArcanistMap variant ownership", () => {
    const parsed = parseHuijiCards(
      JSON.stringify([card("3000", "old"), card("3001"), card("3000", "last")]),
    );
    assert.deepEqual(
      parsed.map((entry) => [entry.baseId, entry.name]),
      [
        ["3001", "3001"],
        ["3000", "last"],
      ],
    );

    const ownership = buildVariantOwnershipMap([
      makeArcanist(3066, "37", "Thirty-seven", [makeArcanistSkin(30660001)]),
      makeArcanist(3088, "Semmelweis", "Semmelweis", [
        makeArcanistSkin(30880001),
      ]),
    ]);
    const mapped = parseHuijiCards(
      JSON.stringify([
        {
          id: 30660001,
          baseId: "306600",
          name: "37 past",
          href: "https://res1999.huijiwiki.com/wiki/30660001",
        },
        {
          id: 30880001,
          name: "Semmelweis past",
          href: "https://res1999.huijiwiki.com/wiki/30880001",
        },
      ]),
      ownership,
    );
    assert.deepEqual(
      mapped.map((entry) => entry.baseId),
      ["3066", "3088"],
    );
  });

  it("composes fresh Huiji order ahead of legacy absences, fills gaps via Kornblume, and leaves rest CN-only", () => {
    const known: ReleaseOrderCharacter[] = Array.from(
      { length: 105 },
      (_, index) => {
        const baseId = String(3000 + index);
        return {
          id: Number(baseId),
          name: `中文${baseId}`,
          nameEng: `fallback-${baseId}`,
        };
      },
    );
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
    assert.deepEqual(first.huiji, [
      ...firstFresh.map((entry) => entry.baseId),
      "3100",
      "3101",
    ]);
    assert.deepEqual(first.kornblume, ["3103", "3102"]);
    assert.equal(known.length - first.huiji.length - first.kornblume.length, 1);

    const secondFresh = known
      .slice(5, 105)
      .map((entry) => card(String(entry.id)));
    const second = createReleaseOrderSnapshot(known, secondFresh, first.huiji, kb);
    assert.deepEqual(second.huiji, [
      ...secondFresh.map((entry) => entry.baseId),
      "3000",
      "3001",
      "3002",
      "3003",
      "3004",
    ]);
  });

  it("preserves prior snapshot when Huiji fails or returns fewer than 100 known characters without falling back to Kornblume", async () => {
    const known: ReleaseOrderCharacter[] = Array.from(
      { length: 105 },
      (_, index) => {
        const baseId = String(3000 + index);
        return { id: Number(baseId), name: `中文${baseId}`, nameEng: baseId };
      },
    );
    const kb: KornblumeData = { names: {}, characters: [] };
    const temp = mkdtempSync(path.join(tmpdir(), "r1999-release-order-"));
    try {
      const target = path.join(temp, "release-order.json");
      const prior =
        JSON.stringify({ huiji: ["3000"], kornblume: [] }, null, 2) + "\n";
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
      assert.equal(readFileSync(target, "utf-8"), prior);
      assert.equal(fallbackFetched, false);

      const insufficient = JSON.stringify(
        known.slice(0, 99).map((entry) => card(String(entry.id))),
      );
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
      assert.equal(readFileSync(target, "utf-8"), prior);
      assert.equal(fallbackFetched, false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("rejects numeric source IDs and orders CN-only -> Kornblume -> Huiji idempotently with 1-based contiguous numbers", () => {
    assert.throws(() =>
      parseReleaseOrderSources({ huiji: [3156], kornblume: [] }),
    );

    const sources = parseReleaseOrderSources({
      huiji: ["3002", "3001"],
      kornblume: ["3003"],
    });
    const entries = ["3001", "3002", "3003", "3004"].map(makeCharacterEntry);
    const first = recalculateReleaseOrder(structuredClone(entries), sources);
    const second = recalculateReleaseOrder(structuredClone(first), sources);

    assert.deepEqual(
      first.map((entry) => entry.baseId),
      ["3004", "3003", "3002", "3001"],
    );
    assert.deepEqual(
      first.map((entry) => entry.releaseOrder),
      [1, 2, 3, 4],
    );
    assert.deepEqual(second, first);
  });
});
