import type { ExportProgress, ExportSnapshot } from "../types/export";

export type ExportJobStatus = "idle" | "working" | "error";

export interface ExportJobState {
  status: ExportJobStatus;
  snapshot: ExportSnapshot | null;
  progress: ExportProgress | null;
  error: string | null;
}

export type ExportRunner = (
  target: HTMLElement,
  onProgress: (value: ExportProgress) => void,
) => Promise<void>;

export interface ExportJobOptions {
  getTarget: () => HTMLElement | null;
  /** Override only for interface tests; production waits for the committed canvas. */
  waitForRender?: () => Promise<void>;
  /** Override only for interface tests; production loads the browser renderer lazily. */
  runExport?: ExportRunner;
}

export interface ExportJob {
  getState: () => ExportJobState;
  subscribe: (listener: () => void) => () => void;
  start: (snapshot: ExportSnapshot) => boolean;
  dismissError: () => void;
  dispose: () => void;
}

function cloneProfile(profile: ExportSnapshot["profile"]): ExportSnapshot["profile"] {
  return JSON.parse(JSON.stringify(profile)) as ExportSnapshot["profile"];
}

function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Timed out waiting for export canvas"));
    }, 5_000);
    requestAnimationFrame(() => {
      clearTimeout(timeoutId);
      resolve();
    });
  });
}

async function waitForCommittedCanvas(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

async function runBrowserExport(
  target: HTMLElement,
  onProgress: (value: ExportProgress) => void,
): Promise<void> {
  const { exportJpeg } = await import("./export-image");
  await exportJpeg(target, onProgress);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const INITIAL_STATE: ExportJobState = {
  status: "idle",
  snapshot: null,
  progress: null,
  error: null,
};

export function createExportJob(options: ExportJobOptions): ExportJob {
  const listeners = new Set<() => void>();
  const waitForRender = options.waitForRender ?? waitForCommittedCanvas;
  const runExport = options.runExport ?? runBrowserExport;
  let state = INITIAL_STATE;
  let nextRunId = 0;
  let activeRunId = 0;
  let disposed = false;

  const emit = (next: ExportJobState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  const isActive = (runId: number): boolean =>
    !disposed && activeRunId === runId;

  const execute = async (runId: number): Promise<void> => {
    try {
      await waitForRender();
      if (!isActive(runId)) return;
      const target = options.getTarget();
      if (!target) throw new Error("Export canvas is unavailable");
      await runExport(target, (progress) => {
        if (isActive(runId)) emit({ ...state, progress });
      });
      if (!isActive(runId)) return;
      activeRunId = 0;
      emit({ status: "idle", snapshot: null, progress: null, error: null });
    } catch (error) {
      if (!isActive(runId)) return;
      activeRunId = 0;
      emit({
        status: "error",
        snapshot: null,
        progress: null,
        error: errorMessage(error),
      });
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: (input) => {
      if (disposed || activeRunId !== 0) return false;
      const runId = ++nextRunId;
      activeRunId = runId;
      const snapshot: ExportSnapshot = {
        ...input,
        profile: cloneProfile(input.profile),
      };
      emit({
        status: "working",
        snapshot,
        progress: null,
        error: null,
      });
      void execute(runId);
      return true;
    },
    dismissError: () => {
      if (disposed || state.status !== "error") return;
      emit(INITIAL_STATE);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      activeRunId = 0;
      state = INITIAL_STATE;
      listeners.clear();
    },
  };
}
