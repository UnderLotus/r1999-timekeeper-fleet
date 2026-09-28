import assert from "node:assert/strict";
import {
  loadHashCache,
  parseHashCache,
  type HashCache,
} from "./sync-assets";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(tmpdir(), "r1999-asset-hash-cache-"));
const digest = "a".repeat(64);
const otherDigest = "b".repeat(64);
const valid: HashCache = {
  "1201": { png: digest, webp: otherDigest },
  "312503": { png: "preserved", webp: "retained-webp" },
  "9912": { png: "retained", webp: "webp-sentinel-compatible" },
};

try {
  assert.deepEqual(
    loadHashCache(path.join(root, "absent.json")),
    {},
    "an absent cache file is optional",
  );

  const validFile = path.join(root, "valid.json");
  writeFileSync(validFile, JSON.stringify(valid));
  assert.deepEqual(loadHashCache(validFile), valid, "normal and sentinel entries are accepted");
  assert.deepEqual(parseHashCache(valid), valid, "the pure parser preserves valid entries");

  const malformedJson = path.join(root, "malformed.json");
  writeFileSync(malformedJson, "{");
  assert.throws(() => loadHashCache(malformedJson), SyntaxError, "malformed JSON is fatal");

  for (const [name, value] of [
    ["array", []],
    ["null", null],
    ["invalid-id", { abc: valid["1201"] }],
    ["invalid-entry-root", { "1201": null }],
    ["invalid-png", { "1201": { png: "not-a-digest", webp: otherDigest } }],
    ["empty-png", { "1201": { png: "", webp: otherDigest } }],
    ["empty-webp", { "1201": { png: digest, webp: "" } }],
    ["wrong-types", { "1201": { png: digest, webp: 42 } }],
  ] as const) {
    const file = path.join(root, `${name}.json`);
    writeFileSync(file, JSON.stringify(value));
    assert.throws(() => loadHashCache(file));
  }

  const readFailure = path.join(root, "read-failure");
  mkdirSync(readFailure);
  assert.throws(() => loadHashCache(readFailure));
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("asset hash cache regressions: passed");
