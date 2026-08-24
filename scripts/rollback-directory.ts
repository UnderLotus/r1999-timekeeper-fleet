import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
/** Validated staging install with catchable-error rollback. Caller must hold the sync lock. */
export async function replaceDirectoryWithRollback(
  staging: string,
  target: string,
): Promise<void> {
  const backup = `${target}.backup-${randomUUID()}`;
  let oldMoved = false,
    newInstalled = false;
  try {
    if (existsSync(target)) {
      await rename(target, backup);
      oldMoved = true;
    }
    await rename(staging, target);
    newInstalled = true;
  } catch (error) {
    if (newInstalled) await rm(target, { recursive: true, force: true });
    if (oldMoved) await rename(backup, target);
    throw error;
  }
  if (oldMoved) await rm(backup, { recursive: true, force: true });
}
