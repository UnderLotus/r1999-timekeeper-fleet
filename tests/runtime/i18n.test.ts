import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectLanguage } from "../../src/i18n/detect-language";
import { getUiText, LANGS } from "../../src/i18n/ui";
import type { LangCode } from "../../src/types/catalog";

describe("i18n", () => {
  it("resolves browser locales to the five supported application locales", () => {
    const cases: Array<[string, LangCode]> = [
      ["zh-TW", "zh-TW"],
      ["zh-HK", "zh-TW"],
      ["zh-CN", "zh-CN"],
      ["zh-SG", "zh-CN"],
      ["zh", "zh-CN"],
      ["ja-JP", "ja-JP"],
      ["ko-KR", "ko-KR"],
      ["en-GB", "en-US"],
      ["fr-FR", "en-US"],
    ];
    for (const [browserLocale, expected] of cases) {
      assert.equal(detectLanguage(browserLocale), expected, browserLocale);
    }
  });

  it("exposes every supported locale once and falls back unknown keys to the key", () => {
    const codes = LANGS.map(({ code }) => code);
    assert.equal(codes.length, new Set(codes).size);
    assert.deepEqual(
      [...codes].sort(),
      ["en-US", "ja-JP", "ko-KR", "zh-CN", "zh-TW"],
    );
    assert.equal(
      getUiText("ja-JP", "__missing_ui_key__"),
      "__missing_ui_key__",
    );
  });

  it("preserves and interpolates all parameterized placeholders across every locale", () => {
    const parameterizedKeys: Array<
      [key: string, params: Record<string, string | number>]
    > = [
      ["addCharacterNamed", { name: "NAME" }],
      ["editCharacterNamed", { name: "NAME" }],
      ["assignCharacterNamed", { name: "NAME" }],
      ["openSkinNamed", { name: "NAME" }],
      ["removeCharacterNamed", { name: "NAME" }],
      ["clearSlotLabel", { team: 1, slot: 2 }],
      ["decreaseValue", { name: "VAL" }],
      ["increaseValue", { name: "VAL" }],
      ["confirmImportBody", { c: 3, p: 4 }],
      ["confirmImportFutureBody", { c: 3, p: 4 }],
      ["clearTeamBody", { n: 2 }],
      ["removeCharBody", { name: "NAME" }],
      ["teamN", { n: 1 }],
      ["teamNameLimit", { n: 12 }],
      ["slotN", { n: 4 }],
      ["assignmentBar", { t: "TEAM", s: 2, kind: "KIND" }],
      ["exportProgress", { loaded: 5, total: 10 }],
    ];

    for (const { code: locale } of LANGS) {
      for (const [key, params] of parameterizedKeys) {
        const template = getUiText(locale, key);
        const rendered = getUiText(locale, key, params);
        for (const [param, value] of Object.entries(params)) {
          assert.ok(
            template.includes(`{${param}}`),
            `${locale}.${key} missing {${param}}`,
          );
          assert.ok(
            rendered.includes(String(value)),
            `${locale}.${key} failed to interpolate ${param}`,
          );
        }
        assert.doesNotMatch(
          rendered,
          /\{[^}]+\}/,
          `${locale}.${key} has unresolved placeholder: ${rendered}`,
        );
      }
    }
  });
});
