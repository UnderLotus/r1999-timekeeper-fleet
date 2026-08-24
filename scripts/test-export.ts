import {
  exportJpeg,
  usesWebKitExportWorkaround,
  type ExportProgress,
} from "../src/utils/export-image";

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

check(
  "iPhone Safari uses the direct canvas fallback",
  usesWebKitExportWorkaround(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  ),
);
check(
  "desktop Safari uses the direct canvas fallback",
  usesWebKitExportWorkaround(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
  ),
);
check(
  "Chromium keeps the established Roster domToJpeg path",
  !usesWebKitExportWorkaround(
    "Mozilla/5.0 AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  ),
);

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
let error = "";
try {
  await exportJpeg(root, (value) => progress.push(value));
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
}

check(
  "broken export image fails before capture",
  error.includes("Failed to load export asset: broken.webp"),
);
check(
  "image loading reports initial progress before failure",
  progress.length === 1 &&
    progress[0].phase === "loading" &&
    progress[0].loaded === 0 &&
    progress[0].total === 1,
);

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: nativeWindow,
});
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: nativeDocument,
});

console.log(`\nexport tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
