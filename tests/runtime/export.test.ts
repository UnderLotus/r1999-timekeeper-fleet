import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExportSnapshot } from "../../src/types/export";
import { emptyProfile } from "../../src/types/profile";
import {
  cjkBaselineCompensation,
  exportJpeg,
  usesWebKitExportWorkaround,
  type ExportProgress,
} from "../../src/utils/export-image";
import { createExportJob, type ExportRunner } from "../../src/utils/export-job";

function makeSnapshot(): ExportSnapshot {
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
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for export job");
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("export image helpers", () => {
  it("routes Safari/iOS WebKit to the canvas fallback while keeping Chromium on domToJpeg", () => {
    assert.equal(
      usesWebKitExportWorkaround(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      ),
      true,
    );
    assert.equal(
      usesWebKitExportWorkaround(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      ),
      true,
    );
    assert.equal(
      usesWebKitExportWorkaround(
        "Mozilla/5.0 AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      ),
      false,
    );
  });

  it("compensates CJK ideographic baseline offset only for CJK text with finite negative metrics", () => {
    assert.equal(
      cjkBaselineCompensation("タイムキーパー編成", -6.8638916015625),
      6.8638916015625,
    );
    assert.equal(
      cjkBaselineCompensation("司辰編隊", -6.8638916015625),
      6.8638916015625,
    );
    assert.equal(
      cjkBaselineCompensation("타임키퍼 편성", -6.8638916015625),
      6.8638916015625,
    );
    assert.equal(
      cjkBaselineCompensation("Timekeeper Fleet", -6.8638916015625),
      0,
    );
    assert.equal(cjkBaselineCompensation("司辰編隊", Number.NaN), 0);
  });

  it("reports initial loading progress and aborts before capture when an export image is broken", async () => {
    const nativeWindow = globalThis.window;
    const nativeDocument = globalThis.document;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        setTimeout(handler: TimerHandler): number {
          queueMicrotask(() =>
            typeof handler === "function" ? handler() : Function(handler)(),
          );
          return 1;
        },
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { fonts: { ready: Promise.resolve() } },
    });

    try {
      const progress: ExportProgress[] = [];
      const brokenImage = {
        complete: true,
        naturalWidth: 0,
        currentSrc: "broken.webp",
        src: "broken.webp",
        loading: "lazy",
        decode: () => Promise.reject(new Error("decode failed")),
      };
      const root = {
        querySelectorAll: () => [brokenImage],
      } as unknown as HTMLElement;

      await assert.rejects(
        () => exportJpeg(root, (value) => progress.push(value)),
        /Failed to load export asset: broken\.webp/,
      );
      assert.deepEqual(progress, [{ phase: "loading", loaded: 0, total: 1 }]);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: nativeWindow,
      });
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: nativeDocument,
      });
    }
  });
});

describe("export job lifecycle", () => {
  it("clones an immutable snapshot, locks concurrent runs, exposes progress, and returns to idle", async () => {
    const target = {} as HTMLElement;
    let release = () => {};
    const runner: ExportRunner = async (_target, onProgress) => {
      onProgress({ phase: "rendering", loaded: 0, total: 0 });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const job = createExportJob({
      getTarget: () => target,
      waitForRender: async () => {},
      runExport: runner,
    });

    const source = makeSnapshot();
    source.profile.teams[0].name = "Stable snapshot";
    assert.equal(job.start(source), true);
    assert.equal(job.start(makeSnapshot()), false);

    // Mutating caller's source after start must not alter the job's snapshot
    source.profile.teams[0].name = "Mutated after start";
    source.lang = "ja-JP";
    source.mode = "pool";
    source.revealFuture = true;
    assert.equal(
      job.getState().snapshot?.profile.teams[0].name,
      "Stable snapshot",
    );
    assert.equal(job.getState().snapshot?.lang, "en-US");
    assert.equal(job.getState().snapshot?.mode, "both");
    assert.equal(job.getState().snapshot?.revealFuture, false);

    await waitFor(() => job.getState().progress !== null);
    assert.equal(job.getState().progress?.phase, "rendering");

    release();
    await waitFor(() => job.getState().status === "idle");
    job.dispose();
  });

  it("surfaces a renderer failure and completes a retry after dismissal", async () => {
    const target = {} as HTMLElement;
    let sawProgress = false;
    let attempts = 0;
    const failedJob = createExportJob({
      getTarget: () => target,
      waitForRender: async () => {},
      runExport: async (_target, onProgress) => {
        onProgress({ phase: "loading", loaded: 1, total: 2 });
        if (++attempts === 1) throw new Error("encoding failed");
      },
    });
    const unsubscribe = failedJob.subscribe(() => {
      if (failedJob.getState().progress?.loaded === 1) sawProgress = true;
    });
    failedJob.start(makeSnapshot());
    await waitFor(() => failedJob.getState().status === "error");

    assert.equal(failedJob.getState().error, "encoding failed");
    assert.equal(sawProgress, true);

    failedJob.dismissError();
    assert.equal(failedJob.getState().status, "idle");
    assert.equal(failedJob.getState().error, null);
    assert.equal(failedJob.start(makeSnapshot()), true);
    await waitFor(() => failedJob.getState().status === "idle");
    assert.equal(attempts, 2);
    unsubscribe();
    failedJob.dispose();
  });
});
