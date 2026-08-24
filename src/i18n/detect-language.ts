import type { LangCode } from "../types/catalog";

/** Resolve a browser locale once for a new visitor. */
export function detectLanguage(locale: string): LangCode {
  const value = locale.trim().replaceAll("_", "-").toLowerCase();

  if (value === "zh" || value.startsWith("zh-")) {
    if (
      value === "zh-tw" ||
      value.startsWith("zh-tw-") ||
      value === "zh-hk" ||
      value.startsWith("zh-hk-") ||
      value === "zh-mo" ||
      value.startsWith("zh-mo-") ||
      value === "zh-hant" ||
      value.startsWith("zh-hant-")
    )
      return "zh-TW";
    return "zh-CN";
  }
  if (value === "ja" || value.startsWith("ja-")) return "ja-JP";
  if (value === "ko" || value.startsWith("ko-")) return "ko-KR";
  return "en-US";
}
