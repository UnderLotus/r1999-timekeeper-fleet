import {
  closeSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
const LOCK_FILE = path.join("/tmp", "r1999-team-list-sync.lock");
function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    return code !== "ESRCH";
  }
}
function acquireLock(): number {
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;
    try {
      fd = openSync(LOCK_FILE, "wx");
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code !== "EEXIST") throw error;
      let owner = 0;
      try {
        owner = Number(readFileSync(LOCK_FILE, "utf-8").trim());
      } catch {}
      if (processIsAlive(owner))
        throw new Error(`Another catalog/asset sync is running (PID ${owner})`);
      rmSync(LOCK_FILE, { force: true });
      continue;
    }
    try {
      writeFileSync(fd, `${process.pid}\n`);
      return fd;
    } catch (error) {
      closeSync(fd);
      rmSync(LOCK_FILE, { force: true });
      throw error;
    }
  }
  throw new Error(`Could not acquire sync lock (${LOCK_FILE})`);
}
export async function withPipelineLock<T>(run: () => Promise<T>): Promise<T> {
  if (process.env.R1999_SYNC_LOCK_HELD === "1") return run();
  const fd = acquireLock();
  try {
    return await run();
  } finally {
    closeSync(fd);
    rmSync(LOCK_FILE, { force: true });
  }
}
