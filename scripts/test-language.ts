import { detectLanguage } from "../src/i18n/detect-language";
import { getUiText, LANGS } from "../src/i18n/ui";
import { ADD_DEFAULT, useBoxStore } from "../src/store/boxStore";
import type { LangCode } from "../src/types/catalog";

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

const cases: Array<[string, LangCode]> = [
  ["zh-TW", "zh-TW"],
  ["zh-HK", "zh-TW"],
  ["zh-Hant-HK", "zh-TW"],
  ["zh-CN", "zh-CN"],
  ["zh-SG", "zh-CN"],
  ["zh", "zh-CN"],
  ["zh-Hans-SG", "zh-CN"],
  ["ja-JP", "ja-JP"],
  ["ko-KR", "ko-KR"],
  ["en-GB", "en-US"],
  ["fr-FR", "en-US"],
];
for (const [browserLocale, expected] of cases)
  check(
    `${browserLocale} resolves to ${expected}`,
    detectLanguage(browserLocale) === expected,
  );

const supportedLocales = LANGS.map(({ code }) => code);
check(
  "UI exposes each supported locale exactly once",
  supportedLocales.length === new Set(supportedLocales).size &&
    (["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as LangCode[]).every(
      (locale) => supportedLocales.includes(locale),
    ),
);
check(
  "localized templates preserve and interpolate required placeholders",
  supportedLocales.every((locale) => {
    const template = getUiText(locale, "assignmentBar");
    const rendered = getUiText(locale, "assignmentBar", {
      t: "TEAM",
      s: 2,
      kind: "KIND",
    });
    return (
      ["{t}", "{s}", "{kind}"].every((token) => template.includes(token)) &&
      ["TEAM", "2", "KIND"].every((value) => rendered.includes(value)) &&
      !/{[^}]+}/.test(rendered)
    );
  }),
);
check(
  "unknown UI keys fall back to the key",
  getUiText("ja-JP", "__missing_ui_key__") === "__missing_ui_key__",
);

function resetLanguage(): void {
  useBoxStore.setState({
    preferences: {
      lang: "zh-TW",
      langChosen: false,
      showFutureSight: false,
      addDefaults: { ...ADD_DEFAULT },
      defaultSkinMode: "initial",
    },
  });
}

resetLanguage();
useBoxStore.getState().initializeLanguage("zh-SG");
check(
  "first browser detection selects and locks the language",
  useBoxStore.getState().preferences.lang === "zh-CN" &&
    useBoxStore.getState().preferences.langChosen,
);
useBoxStore.getState().initializeLanguage("ja-JP");
check(
  "reload detection cannot replace the first automatic choice",
  useBoxStore.getState().preferences.lang === "zh-CN",
);
resetLanguage();
useBoxStore.getState().setLang("ko-KR");
useBoxStore.getState().initializeLanguage("zh-CN");
check(
  "a manual language choice is never replaced by browser detection",
  useBoxStore.getState().preferences.lang === "ko-KR" &&
    useBoxStore.getState().preferences.langChosen,
);

console.log(`\nlanguage tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
