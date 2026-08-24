import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { replaceDirectoryWithRollback } from "./rollback-directory";
import { withPipelineLock } from "./sync-lock";
const root = await mkdtemp(path.join(os.tmpdir(), "r1999-rollback-"));
try {
  const target = path.join(root, "cache"),
    staging = path.join(root, "staging");
  await mkdir(target);
  await writeFile(path.join(target, "value"), "old");
  await mkdir(staging);
  await writeFile(path.join(staging, "value"), "new");
  await replaceDirectoryWithRollback(staging, target);
  assert.equal(await readFile(path.join(target, "value"), "utf-8"), "new");
  await assert.rejects(() =>
    replaceDirectoryWithRollback(path.join(root, "missing"), target),
  );
  assert.equal(await readFile(path.join(target, "value"), "utf-8"), "new");
  await withPipelineLock(async () => {
    await assert.rejects(
      () => withPipelineLock(async () => undefined),
      (error) =>
        error instanceof Error &&
        error.message.includes("Another catalog/asset sync"),
    );
  });
  console.log("rollback/lock tests: 3 passed, 0 failed");
} finally {
  await rm(root, { recursive: true, force: true });
}
