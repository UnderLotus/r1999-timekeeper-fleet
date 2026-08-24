import { execFileSync } from "node:child_process";
import { withPipelineLock } from "./sync-lock";
await withPipelineLock(async () => {
  const env = { ...process.env, R1999_SYNC_LOCK_HELD: "1" };
  for (const script of ["sync:names", "build:source", "build:characters"])
    execFileSync("npm", ["run", script], { stdio: "inherit", env });
});
