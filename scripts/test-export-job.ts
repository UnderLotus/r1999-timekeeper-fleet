import { emptyProfile } from "../src/types/profile";
import {
  createExportJob,
  type ExportJobState,
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
const states: ExportJobState[] = [];
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
const unsubscribe = runningJob.subscribe(() => states.push(runningJob.getState()));
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
check("successful jobs release the snapshot and return idle", true);
unsubscribe();
runningJob.dispose();

const missingTargetJob = createExportJob({
  getTarget: () => null,
  waitForRender: async () => {},
  runExport: async () => {
    throw new Error("renderer should not run without a target");
  },
});
missingTargetJob.start(snapshot());
await waitFor(() => missingTargetJob.getState().status === "error");
check(
  "missing render targets become recoverable job errors",
  missingTargetJob.getState().error === "Export canvas is unavailable",
);
missingTargetJob.dismissError();
check(
  "the UI can dismiss a recoverable error and return idle",
  missingTargetJob.getState().status === "idle" &&
    missingTargetJob.getState().error === null,
);
missingTargetJob.dispose();

const timedOutJob = createExportJob({
  getTarget: () => target,
  waitForRender: async () => {
    throw new Error("Timed out waiting for export canvas");
  },
  runExport: async () => {},
});
timedOutJob.start(snapshot());
await waitFor(() => timedOutJob.getState().status === "error");
check(
  "render readiness timeouts reset busy state",
  timedOutJob.getState().error === "Timed out waiting for export canvas",
);
timedOutJob.dispose();

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
failedUnsubscribe();
failedJob.dispose();

let disposeRelease: () => void = () => {};
const disposableJob = createExportJob({
  getTarget: () => target,
  waitForRender: async () => {},
  runExport: async (_target, onProgress) => {
    onProgress({ phase: "rendering", loaded: 0, total: 0 });
    await new Promise<void>((resolve) => {
      disposeRelease = resolve;
    });
  },
});
let disposeNotifications = 0;
const disposeUnsubscribe = disposableJob.subscribe(() => {
  disposeNotifications++;
});
disposableJob.start(snapshot());
await waitFor(() => disposableJob.getState().progress !== null);
const notificationsBeforeDispose = disposeNotifications;
disposableJob.dispose();
disposeRelease();
await new Promise((resolve) => setTimeout(resolve, 0));
check(
  "disposing a job releases its busy state and blocks later starts",
  disposableJob.getState().status === "idle" && !disposableJob.start(snapshot()),
);
check(
  "a stale renderer completion cannot notify after disposal",
  disposeNotifications === notificationsBeforeDispose,
);
disposeUnsubscribe();

console.log(`\nexport job tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
