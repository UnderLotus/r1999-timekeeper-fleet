import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { UpstreamRefreshError } from "../../scripts/sync-refresh";
import {
  loadUttuNames,
  refreshUttuNames,
  UTTU_NAMES_SCHEMA_VERSION,
} from "../../scripts/uttu-names";
import {
  parseUttuProfileNames,
  parseUttuPsychubeNames,
  UttuParseError,
} from "../../scripts/uttu-parser";

const profilesHtml = `<html><script>const T=[
{ID:9001,Name:"甲",Rarity:6,LocaleName:{en:"Alpha",zh:"甲",tw:"甲繁",jp:"N/A"}},
{ID:9002,Name:"乙",Rarity:4,LocaleName:{en:"Beta",zh:"乙",kr:"베타"}}
];</script></html>`;

const psychubesHtml = `<html><script>const P=[
{id:"1575",slug:"arrow-of-verdict",iconImageId:"9001",name:["Arrow","宣告","宣告繁","弦の調べ","활시위"]},
{id:"1452",slug:"the-path",iconImageId:"1452",name:["Path","完满","N/A","N/A","N/A"]}
];</script></html>`;

describe("UTTU locale name parser", () => {
  it("parses exact-ID character and psychube locale names and ignores missing metadata or N/A", () => {
    assert.deepEqual(
      parseUttuProfileNames(
        `<html><script>const T=[{ID:9003,LocaleName:{jp:"名前だけ"}}];</script></html>`,
      ),
      [{ id: "9003", names: { "ja-JP": "名前だけ" } }],
    );
    assert.deepEqual(parseUttuProfileNames(profilesHtml), [
      { id: "9001", names: { "zh-TW": "甲繁" } },
      { id: "9002", names: { "ko-KR": "베타" } },
    ]);
    assert.deepEqual(parseUttuPsychubeNames(psychubesHtml), [
      {
        id: "1575",
        names: { "zh-TW": "宣告繁", "ja-JP": "弦の調べ", "ko-KR": "활시위" },
      },
    ]);
  });

  it("rejects malformed five-locale arrays and duplicate psychube IDs", () => {
    assert.throws(
      () =>
        parseUttuPsychubeNames(
          `<html><script>const P=[{id:"1575",name:["Arrow","宣告","宣告繁","弦"]}];</script></html>`,
        ),
      /does not list exactly five locale names/,
    );
    assert.throws(
      () =>
        parseUttuPsychubeNames(
          `<html><script>const P=[
{id:"1575",name:["Arrow","宣告","宣告繁","弦","활"]},
{id:"1575",name:["Arrow","宣告","宣告繁","弦","활"]}
];</script></html>`,
        ),
      /Duplicate UTTU psychube ID: 1575/,
    );
  });
});

describe("UTTU locale name snapshot refresh", () => {
  it("writes deterministic timestamp-free snapshots, isolates per-region outages, retains LKG, and fails on local errors", () => {
    const root = mkdtempSync(path.join(tmpdir(), "r1999-uttu-names-"));
    try {
      const file = path.join(root, "uttu-names.json");
      const first = refreshUttuNames(
        { profiles: () => profilesHtml, psychubes: () => psychubesHtml },
        file,
      );
      assert.deepEqual(first, { warnings: [], characters: 2, psychubes: 1 });

      const written = readFileSync(file, "utf-8");
      const parsed = JSON.parse(written) as Record<string, unknown>;
      assert.equal(parsed.schemaVersion, UTTU_NAMES_SCHEMA_VERSION);
      // Verify exact top-level schema keys (no per-run timestamp or audit metadata)
      assert.deepEqual(Object.keys(parsed).sort(), [
        "characters",
        "psychubes",
        "schemaVersion",
      ]);

      // Identical input produces byte-identical output
      refreshUttuNames(
        { profiles: () => profilesHtml, psychubes: () => psychubesHtml },
        file,
      );
      assert.equal(readFileSync(file, "utf-8"), written);

      // Psychube outage preserves psychube LKG while updating character names
      const psychubeOutage = refreshUttuNames(
        {
          profiles: () =>
            `<html><script>const T=[{ID:9001,Name:"甲",LocaleName:{tw:"甲繁改了"}}];</script></html>`,
          psychubes: () => {
            throw new UpstreamRefreshError("fixture psychube 404");
          },
        },
        file,
      );
      assert.equal(psychubeOutage.warnings.length, 1);
      assert.match(psychubeOutage.warnings[0], /psychube names/);
      assert.deepEqual(loadUttuNames(file), {
        schemaVersion: 1,
        characters: [
          { id: "9001", names: { "zh-TW": "甲繁改了" } },
          { id: "9002", names: { "ko-KR": "베타" } },
        ],
        psychubes: [
          {
            id: "1575",
            names: { "zh-TW": "宣告繁", "ja-JP": "弦の調べ", "ko-KR": "활시위" },
          },
        ],
      });

      // Profiles parse outage preserves character LKG while updating psychube names without clearing missing locales
      const profileOutage = refreshUttuNames(
        {
          profiles: () => {
            throw new UttuParseError("fixture profiles parse failure");
          },
          psychubes: () =>
            `<html><script>const P=[{id:"1575",name:["Arrow","宣告","宣告繁新","N/A","활시위"]}];</script></html>`,
        },
        file,
      );
      assert.equal(profileOutage.warnings.length, 1);
      assert.match(profileOutage.warnings[0], /character names/);
      const afterProfileOutage = loadUttuNames(file);
      assert.deepEqual(afterProfileOutage.characters, [
        { id: "9001", names: { "zh-TW": "甲繁改了" } },
        { id: "9002", names: { "ko-KR": "베타" } },
      ]);
      assert.deepEqual(afterProfileOutage.psychubes, [
        {
          id: "1575",
          names: { "zh-TW": "宣告繁新", "ja-JP": "弦の調べ", "ko-KR": "활시위" },
        },
      ]);

      // Shrunken page or N/A locale never clears stored names
      const shrunken = refreshUttuNames(
        {
          profiles: () =>
            `<html><script>const T=[{ID:9001,Name:"甲",LocaleName:{tw:"N/A"}}];</script></html>`,
          psychubes: () => psychubesHtml,
        },
        file,
      );
      assert.equal(shrunken.characters, 2);
      assert.deepEqual(loadUttuNames(file).characters, [
        { id: "9001", names: { "zh-TW": "甲繁改了" } },
        { id: "9002", names: { "ko-KR": "베타" } },
      ]);

      // Local programming errors and corrupt local snapshots remain fatal
      assert.throws(
        () =>
          refreshUttuNames(
            {
              profiles: () => {
                throw new Error("fixture programming failure");
              },
              psychubes: () => psychubesHtml,
            },
            file,
          ),
        /fixture programming failure/,
      );

      writeFileSync(
        file,
        JSON.stringify({ schemaVersion: 2, characters: [], psychubes: [] }),
      );
      assert.throws(() => loadUttuNames(file), /schemaVersion/);

      writeFileSync(
        file,
        JSON.stringify({
          schemaVersion: 1,
          characters: [{ id: "1001", names: { jp: "新訳" } }],
          psychubes: [],
        }),
      );
      assert.throws(() => loadUttuNames(file), /has no names/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
