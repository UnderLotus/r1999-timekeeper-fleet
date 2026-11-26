import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertKnownCatalogPolicy,
  parseCatalogPolicy,
} from "../../scripts/catalog-policy";
import {
  assertKnownOverrides,
  parseReleaseOverrides,
  resolveCharacterRelease,
  resolveGlobalIsOnline,
  resolvePsychubeRelease,
  resolveSkinRelease,
  uniqueOverrides,
} from "../../scripts/release-status";
import { makeEmptyPolicy } from "../helpers/pipeline-fixtures";

describe("release-status rules", () => {
  const releaseClock = new Date("2026-09-03T10:00:00.000Z");
  const globalUtcOffsetMinutes = -5 * 60;

  it("evaluates Global isOnline flags and UTC-05:00 timestamps and fails loudly on malformed values", () => {
    const cases: readonly [string, unknown, boolean][] = [
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
    for (const [label, value, expected] of cases) {
      assert.equal(
        resolveGlobalIsOnline(value, releaseClock, globalUtcOffsetMinutes),
        expected,
        label,
      );
    }

    assert.throws(() =>
      resolveGlobalIsOnline("2", releaseClock, globalUtcOffsetMinutes),
    );
    assert.throws(() =>
      resolveGlobalIsOnline(
        "2026-09-03T05:00:00Z",
        releaseClock,
        globalUtcOffsetMinutes,
      ),
    );
    assert.throws(() =>
      resolveGlobalIsOnline(
        "2026-02-30 05:00:00",
        releaseClock,
        globalUtcOffsetMinutes,
      ),
    );
  });

  it("applies release gates and manual overrides for characters, skins, and psychubes", () => {
    assert.equal(resolveCharacterRelease(true, false), false);
    assert.equal(resolveCharacterRelease(false, true), true);

    assert.equal(resolveSkinRelease("default", false, false), true);
    assert.equal(resolveSkinRelease("insight", undefined, false), true);
    assert.equal(resolveSkinRelease("skin", true), true);
    assert.equal(resolveSkinRelease("skin", false), false);
    assert.equal(resolveSkinRelease("skin", false, true), true);
    assert.equal(resolveSkinRelease("skin", true, false), false);
    assert.throws(() => resolveSkinRelease("skin", undefined));

    assert.equal(resolvePsychubeRelease(true), true);
    assert.equal(resolvePsychubeRelease(false), false);
    assert.equal(resolvePsychubeRelease(false, true), true);
  });

  it("validates unified override schema and rejects legacy, duplicate, or stale overrides", () => {
    assert.throws(() => parseReleaseOverrides({ "3147": false }));

    const parsed = parseReleaseOverrides({
      characters: [{ baseId: 1, isReleased: false, note: "gate" }],
      skins: [{ variantId: "101", isReleased: true }],
      psychubes: [{ id: "1001", isReleased: false }],
    });
    assert.equal(parsed.characters.length, 1);
    assert.equal(parsed.skins.length, 1);
    assert.equal(parsed.psychubes.length, 1);

    assert.throws(() =>
      uniqueOverrides([{ id: "1" }, { id: "1" }], (entry) => entry.id, "fixture"),
    );
    assert.throws(() =>
      assertKnownOverrides(new Map([["2", true]]), new Set(["1"]), "fixture"),
    );
  });
});

describe("catalog-policy validation", () => {
  it("rejects duplicate IDs, stale targets, and ignored CN skin stubs that graduated into ArcanistMap", () => {
    const empty = makeEmptyPolicy();
    assert.throws(() =>
      parseCatalogPolicy({
        ...empty,
        excludedCharacters: [
          { baseId: "1", reason: "a" },
          { baseId: "1", reason: "b" },
        ],
      }),
    );

    assert.throws(() =>
      assertKnownCatalogPolicy(
        {
          ...empty,
          preservedCharacterAssets: [{ id: "999999", reason: "fixture" }],
        },
        new Set(),
        new Set(),
        new Set(),
      ),
    );

    // Ignored stub that is now in ArcanistMap must fail loudly for human review
    assert.throws(
      () =>
        assertKnownCatalogPolicy(
          {
            ...empty,
            ignoredCnSkinStubs: [{ id: "308005", reason: "empty stub" }],
          },
          new Set(),
          new Set(),
          new Set(["308005"]),
          new Set(["308005"]),
        ),
      /now listed in ArcanistMap/,
    );
  });
});
