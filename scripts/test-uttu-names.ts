/** UTTU exact-ID locale names: literal parsing, per-region LKG and atomic snapshots. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { UpstreamRefreshError } from "./sync-refresh";
import {
  parseUttuProfileNames,
  parseUttuPsychubeNames,
  UttuParseError,
} from "./uttu-parser";
import {
  indexUttuNames,
  loadUttuNames,
  refreshUttuNames,
  saveUttuNames,
  UTTU_NAMES_SCHEMA_VERSION,
} from "./uttu-names";

const profilesHtml = `<html><script>const T=[
{ID:9001,Name:"甲",Rarity:6,LocaleName:{en:"Alpha",zh:"甲",tw:"甲繁",jp:"N/A"}},
{ID:9002,Name:"乙",Rarity:4,LocaleName:{en:"Beta",zh:"乙",kr:"베타"}}
];</script></html>`;
const psychubesHtml = `<html><script>const P=[
{id:"1575",slug:"arrow-of-verdict",iconImageId:"9001",name:["Arrow","宣告","宣告繁","弦の調べ","활시위"]},
{id:"1452",slug:"the-path",iconImageId:"1452",name:["Path","完满","N/A","N/A","N/A"]}
];</script></html>`;

assert.deepEqual(
  parseUttuProfileNames(
    `<html><script>const T=[{ID:9003,LocaleName:{jp:"名前だけ"}}];</script></html>`,
  ),
  [{ id: "9003", names: { "ja-JP": "名前だけ" } }],
  "a profile row without any other metadata still supplies its translation",
);
assert.deepEqual(
  parseUttuProfileNames(profilesHtml),
  [
    { id: "9001", names: { "zh-TW": "甲繁" } },
    { id: "9002", names: { "ko-KR": "베타" } },
  ],
  "profile names ignore missing metadata and treat N/A as absent",
);
assert.deepEqual(
  parseUttuPsychubeNames(psychubesHtml),
  [{ id: "1575", names: { "zh-TW": "宣告繁", "ja-JP": "弦の調べ", "ko-KR": "활시위" } }],
  "psychube names use the exact id, never iconImageId, and omit all-N/A rows",
);
assert.throws(
  () => parseUttuProfileNames("<html><body>empty</body></html>"),
  UttuParseError,
  "an empty profiles page is a region failure, not an empty name set",
);
assert.throws(
  () =>
    parseUttuProfileNames(
      `<html><script>const T=[{ID:window.id,Name:"甲",Rarity:6,LocaleName:{tw:"甲繁"}}];</script></html>`,
    ),
  UttuParseError,
  "non-literal profile rows are rejected instead of executed",
);
assert.throws(
  () =>
    parseUttuProfileNames(
      `<html><script>const T=[
{ID:9001,Name:"甲",Rarity:6,LocaleName:{tw:"甲繁"}},
{ID:9001,Name:"甲",Rarity:6,LocaleName:{tw:"甲繁"}}
];</script></html>`,
    ),
  /Duplicate UTTU profile ID: 9001/,
  "duplicate profile IDs stay a source contradiction",
);
assert.throws(
  () =>
    parseUttuPsychubeNames(
      `<html><script>const P=[{id:"1575",name:["Arrow","宣告","宣告繁","弦"]}];</script></html>`,
    ),
  /does not list exactly five locale names/,
  "a short five-locale array fails the whole psychube region",
);
assert.throws(
  () =>
    parseUttuPsychubeNames(
      `<html><script>const P=[{id:"1575",name:["Arrow","宣告",3,"弦","활"]}];</script></html>`,
    ),
  /does not list exactly five locale names/,
  "a non-string locale entry fails the whole psychube region",
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
  "duplicate psychube IDs stay a source contradiction",
);

const root = mkdtempSync(path.join(tmpdir(), "r1999-uttu-names-"));
try {
  const file = path.join(root, "uttu-names.json");
  const first = refreshUttuNames(
    { profiles: () => profilesHtml, psychubes: () => psychubesHtml },
    file,
  );
  assert.deepEqual(first, { warnings: [], characters: 2, psychubes: 1 });
  const written = readFileSync(file, "utf-8");
  assert.equal(
    JSON.parse(written).schemaVersion,
    UTTU_NAMES_SCHEMA_VERSION,
    "the snapshot is versioned",
  );
  assert.equal(
    refreshUttuNames(
      { profiles: () => profilesHtml, psychubes: () => psychubesHtml },
      file,
    ).characters,
    2,
  );
  assert.equal(
    readFileSync(file, "utf-8"),
    written,
    "the same pages produce byte-identical snapshots",
  );
  assert.equal(
    written.indexOf('"character"'),
    -1,
    "no per-run timestamp or audit text is stored",
  );

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
  assert.deepEqual(
    loadUttuNames(file),
    {
      schemaVersion: 1,
      characters: [
        { id: "9001", names: { "zh-TW": "甲繁改了" } },
        { id: "9002", names: { "ko-KR": "베타" } },
      ],
      psychubes: [
        { id: "1575", names: { "zh-TW": "宣告繁", "ja-JP": "弦の調べ", "ko-KR": "활시위" } },
      ],
    },
    "a psychube outage keeps the psychube LKG while the character names update",
  );

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
  assert.deepEqual(
    afterProfileOutage.characters,
    [
      { id: "9001", names: { "zh-TW": "甲繁改了" } },
      { id: "9002", names: { "ko-KR": "베타" } },
    ],
    "a profiles outage keeps the character LKG",
  );
  assert.deepEqual(
    afterProfileOutage.psychubes,
    [{ id: "1575", names: { "zh-TW": "宣告繁新", "ja-JP": "弦の調べ", "ko-KR": "활시위" } }],
    "a missing locale never clears the stored translation",
  );

  const shrunkenPages = refreshUttuNames(
    {
      profiles: () =>
        `<html><script>const T=[{ID:9001,Name:"甲",LocaleName:{tw:"N/A"}}];</script></html>`,
      psychubes: () => psychubesHtml,
    },
    file,
  );
  assert.equal(shrunkenPages.characters, 2, "rows absent upstream keep their previous names");
  assert.deepEqual(
    loadUttuNames(file).characters,
    [
      { id: "9001", names: { "zh-TW": "甲繁改了" } },
      { id: "9002", names: { "ko-KR": "베타" } },
    ],
    "an N/A locale never overwrites the stored name",
  );

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
    "a local programming failure is not an upstream outage",
  );

  writeFileSync(file, "{ not json");
  assert.throws(() => loadUttuNames(file), SyntaxError, "a corrupt snapshot is a local failure");
  writeFileSync(
    file,
    JSON.stringify({ schemaVersion: 2, characters: [], psychubes: [] }),
  );
  assert.throws(() => loadUttuNames(file), /schemaVersion/, "an unknown schema fails the build");
  writeFileSync(
    file,
    JSON.stringify({ schemaVersion: 1, characters: [{ id: "x", names: {} }], psychubes: [] }),
  );
  assert.throws(() => loadUttuNames(file), /invalid id/, "invalid snapshot rows fail the build");

  writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    characters: [{ id: "1001", names: { jp: "新訳" } }],
    psychubes: [],
  }));
  assert.throws(
    () => loadUttuNames(file),
    /has no names/,
    "unknown-only locale keys are a corrupt snapshot, not an empty normalized row",
  );

  const blocked = path.join(root, "blocked");
  writeFileSync(blocked, "not a directory");
  assert.throws(
    () =>
      saveUttuNames(path.join(blocked, "uttu-names.json"), {
        schemaVersion: 1,
        characters: [],
        psychubes: [],
      }),
    /ENOTDIR|EEXIST|ENOENT/,
    "a local snapshot write failure throws instead of being swallowed",
  );

  assert.deepEqual(
    [...indexUttuNames([{ id: "1575", names: { "ja-JP": "弦" } }])],
    [["1575", { "ja-JP": "弦" }]],
    "the composition index is an exact-ID lookup",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("UTTU name refresh checks passed");
