import { domToJpeg } from "modern-screenshot";
import type { ExportProgress } from "../types/export";
export type { ExportProgress } from "../types/export";

const EXPORT_SCALE = 1.5;
const WEBKIT_EXPORT_SCALE = 1.75;
const EXPORT_BACKGROUND = "#eee8da";

export function usesWebKitExportWorkaround(userAgent: string): boolean {
  if (!userAgent.includes("AppleWebKit")) return false;
  const isiOS = /iPad|iPhone|iPod/.test(userAgent);
  const isChromiumDesktop = /Chrome|Chromium|Edg/.test(userAgent);
  return isiOS || !isChromiumDesktop;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) =>
    window.setTimeout(() => reject(new Error(message)), ms),
  );
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      finish(new Error(`Timed out loading export asset: ${image.src}`));
    }, 15_000);
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onLoad = () => finish();
    const onError = () => finish();
    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
    if (image.complete) finish();
  });
}

async function waitForImages(
  root: HTMLElement,
  onProgress?: (value: ExportProgress) => void,
): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  const total = images.length;
  let loaded = 0;
  onProgress?.({ phase: "loading", loaded, total });

  await Promise.all(
    images.map(async (image) => {
      image.loading = "eager";
      await waitForImage(image);
      if (image.naturalWidth === 0)
        throw new Error(
          `Failed to load export asset: ${image.currentSrc || image.src}`,
        );
      await image.decode().catch(() => undefined);
      loaded++;
      onProgress?.({ phase: "loading", loaded, total });
    }),
  );
}

function date(): string {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",");
  if (!data) throw new Error("Invalid export data URL");
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const bytes = atob(data);
  const buffer = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index++)
    buffer[index] = bytes.charCodeAt(index);
  return new Blob([buffer], { type: mime });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return Promise.race([
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Failed to encode export JPEG")),
        "image/jpeg",
        0.92,
      );
    }),
    rejectAfter(15_000, "Timed out encoding export JPEG"),
  ]);
}

/**
 * Safari's SVG foreignObject image decode is still unreliable and can stay
 * pending once many embedded images are present. Use html2canvas-pro's direct
 * renderer only on WebKit; it fixes webfont baseline drift in upstream 1.4.1.
 * foreignObjectRendering must remain disabled.
 */
async function renderWebKitJpeg(element: HTMLElement): Promise<Blob> {
  const target =
    element.querySelector<HTMLElement>(".export-canvas") ?? element;
  const width = target.scrollWidth;
  const height = target.scrollHeight;
  if (!width || !height) throw new Error("Export canvas has no dimensions");

  const { default: html2canvas } = await import("html2canvas-pro");
  const canvas = await Promise.race([
    html2canvas(target, {
      backgroundColor: EXPORT_BACKGROUND,
      foreignObjectRendering: false,
      imageTimeout: 15_000,
      imageSmoothing: true,
      imageSmoothingQuality: "high",
      logging: false,
      // The fork defaults to 100, but a full catalog currently contains 255 images.
      maxCacheSize: 512,
      onclone: (documentClone) => {
        const layer = documentClone.querySelector<HTMLElement>(".export-layer");
        if (layer) {
          layer.style.left = "0";
          layer.style.top = "0";
          layer.style.position = "absolute";
        }
      },
      removeContainer: true,
      scale: WEBKIT_EXPORT_SCALE,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      width,
      height,
    }),
    rejectAfter(60_000, "Timed out rendering WebKit export image"),
  ]);
  return canvasToJpegBlob(canvas);
}

export async function exportJpeg(
  element: HTMLElement,
  onProgress?: (value: ExportProgress) => void,
): Promise<void> {
  const fontsReady =
    "fonts" in document ? document.fonts.ready : Promise.resolve();
  await Promise.race([fontsReady, delay(5_000)]);
  await waitForImages(element, onProgress);
  onProgress?.({ phase: "rendering", loaded: 0, total: 0 });

  const blob = usesWebKitExportWorkaround(navigator.userAgent)
    ? await renderWebKitJpeg(element)
    : dataUrlToBlob(
        await Promise.race([
          domToJpeg(element, {
            quality: 0.92,
            backgroundColor: EXPORT_BACKGROUND,
            scale: EXPORT_SCALE,
          }),
          rejectAfter(60_000, "Timed out rendering export image"),
        ]),
      );

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const revoke = () => URL.revokeObjectURL(objectUrl);
  try {
    anchor.href = objectUrl;
    anchor.download = `r1999-timekeeper-fleet-${date()}.jpg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(revoke, 10_000);
  } catch (error) {
    anchor.remove();
    revoke();
    throw error;
  }
}
