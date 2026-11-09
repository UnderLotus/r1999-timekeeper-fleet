import { emptyProfile } from "../src/types/profile";
import {
  createExportJob,
  type ExportRunner,
} from "../src/utils/export-job";
import type { ExportSnapshot } from "../src/types/export";

let pass = 0;
let fail = 0;
function check(name: string, value: boolean): void {
  if (value) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

function snapshot(): ExportSnapshot {
  return {
    profile: emptyProfile(),
    lang: "en-US",
    mode: "both",
    revealFuture: false,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for export job");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const target = {} as HTMLElement;
let release: () => void = () => {};
const runningRunner: ExportRunner = async (_target, onProgress) => {
  onProgress({ phase: "rendering", loaded: 0, total: 0 });
  await new Promise<void>((resolve) => {
    release = resolve;
  });
};
const runningJob = createExportJob({
  getTarget: () => target,
  waitForRender: async () => {},
  runExport: runningRunner,
});
const source = snapshot();
source.profile.teams[0].name = "Stable snapshot";
source.lang = "en-US";
source.mode = "both";
source.revealFuture = false;
check("start enters the working state", runningJob.start(source));
check("a second export is rejected while the first is running", !runningJob.start(snapshot()));
source.profile.teams[0].name = "Mutated after start";
source.lang = "ja-JP";
source.mode = "pool";
source.revealFuture = true;
check(
  "the job owns an immutable export snapshot",
  runningJob.getState().snapshot?.profile.teams[0].name === "Stable snapshot" &&
    runningJob.getState().snapshot?.lang === "en-US" &&
    runningJob.getState().snapshot?.mode === "both" &&
    runningJob.getState().snapshot?.revealFuture === false,
);
await waitFor(() => runningJob.getState().progress !== null);
check(
  "renderer progress is exposed through the job state",
  runningJob.getState().progress?.phase === "rendering",
);
release();
await waitFor(() => runningJob.getState().status === "idle");
runningJob.dispose();

let sawFailedProgress = false;
const failedJob = createExportJob({
  getTarget: () => target,
  waitForRender: async () => {},
  runExport: async (_target, onProgress) => {
    onProgress({ phase: "loading", loaded: 1, total: 2 });
    throw new Error("encoding failed");
  },
});
const failedUnsubscribe = failedJob.subscribe(() => {
  if (failedJob.getState().progress?.loaded === 1) sawFailedProgress = true;
});
failedJob.start(snapshot());
await waitFor(() => failedJob.getState().status === "error");
check(
  "renderer failures reset busy state and retain an actionable message",
  failedJob.getState().error === "encoding failed" &&
    sawFailedProgress,
);
failedJob.dismissError();
check(
  "a renderer failure is dismissible back to a retryable job",
  failedJob.getState().status === "idle" &&
    failedJob.getState().error === null &&
    failedJob.start(snapshot()),
);
failedUnsubscribe();
failedJob.dispose();

console.log(`\nexport job tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
