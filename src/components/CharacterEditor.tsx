import { useEffect, useRef } from "react";
import type { LangCode } from "../i18n/ui";
import { getUiText } from "../i18n/ui";
import type { CharacterDef, InsightIndex } from "../types/catalog";
import type { CharacterBuild } from "../types/profile";
import { characterName, legalInsights, levelCap } from "../utils/catalog";
import type { AnchorRect } from "../utils/design";
import { Btn, Overlay, SegButtons, Stepper } from "../utils/design";
import { InsightGlyph } from "./InsightGlyph";

export function CharacterEditor({
  def,
  build,
  lang,
  anchor,
  initialField,
  onClose,
  onSetInsight,
  onSetLevel,
  onSetResonance,
  onSetPortray,
}: {
  def: CharacterDef;
  build: CharacterBuild;
  lang: LangCode;
  anchor?: AnchorRect;
  initialField?: "all" | "level" | "resonance";
  onClose: () => void;
  onSetInsight: (value: InsightIndex) => void;
  onSetLevel: (value: number) => void;
  onSetResonance: (value: number) => void;
  onSetPortray: (value: number) => void;
}): React.JSX.Element {
  const t = (key: string, params?: Record<string, string | number>) =>
      getUiText(lang, key, params),
    levelRef = useRef<HTMLElement>(null),
    resRef = useRef<HTMLElement>(null),
    legal = legalInsights(def),
    cap = levelCap(def, build.insight),
    shortcuts = [1, 20, 30, 40, 50, cap].filter(
      (value, index, array) => value <= cap && array.indexOf(value) === index,
    );

  useEffect(() => {
    (initialField === "resonance"
      ? resRef
      : initialField === "level"
        ? levelRef
        : null
    )?.current?.scrollIntoView({ block: "nearest" });
  }, [initialField]);

  return (
    <Overlay
      title={`${characterName(def, lang)} · ${characterName(def, "en-US")}`}
      closeLabel={t("close")}
      onClose={onClose}
      anchor={anchor}
      className="character-editor-panel"
    >
      <div className="editor-modules">
        <section ref={levelRef} className="editor-section">
          <header className="editor-section__head">
            <span>{t("level")}</span>
            <output>
              Lv.{build.level} / {cap}
            </output>
          </header>
          <div className="editor-section__controls">
            <Stepper
              label={t("level")}
              value={build.level}
              min={1}
              max={cap}
              onChange={onSetLevel}
              decreaseLabel={t("decreaseValue", { name: t("level") })}
              increaseLabel={t("increaseValue", { name: t("level") })}
            />
            <SegButtons
              options={shortcuts.map((value) => ({
                key: String(value),
                label: value === cap ? t("max") : String(value),
              }))}
              selected={String(build.level)}
              onSelect={(value) => onSetLevel(Number(value))}
            />
          </div>
        </section>

        <section className="editor-section editor-section--insight">
          <header className="editor-section__head">
            <span>{t("insight")}</span>
            <output className="editor-section__current">
              <InsightGlyph insight={build.insight} />
            </output>
          </header>
          <div className="editor-section__controls">
            <SegButtons
              options={[0, 1, 2, 3].map((value) => ({
                key: String(value),
                label: <InsightGlyph insight={value} />,
                ariaLabel: `${t("insight")} ${value}`,
                disabled: !legal.includes(value as InsightIndex),
              }))}
              className="insight-selector"
              selected={String(build.insight)}
              onSelect={(value) => onSetInsight(Number(value) as InsightIndex)}
            />
          </div>
        </section>

        <section ref={resRef} className="editor-section">
          <header className="editor-section__head">
            <span>{t("resonance")}</span>
            <output>{build.resonance}</output>
          </header>
          <div className="editor-section__controls">
            <Stepper
              label={t("resonance")}
              value={build.resonance}
              min={0}
              max={15}
              onChange={onSetResonance}
              decreaseLabel={t("decreaseValue", { name: t("resonance") })}
              increaseLabel={t("increaseValue", { name: t("resonance") })}
            />
            <SegButtons
              options={[1, 10, 15].map((value) => ({
                key: String(value),
                label: String(value),
              }))}
              selected={
                [1, 10, 15].includes(build.resonance)
                  ? String(build.resonance)
                  : undefined
              }
              onSelect={(value) => onSetResonance(Number(value))}
            />
          </div>
        </section>

        <section className="editor-section">
          <header className="editor-section__head">
            <span>{t("portray")}</span>
          </header>
          <div className="editor-section__controls">
            <SegButtons
              options={[0, 1, 2, 3, 4, 5].map((value) => ({
                key: String(value),
                label: String(value),
              }))}
              selected={String(build.portray)}
              onSelect={(value) => onSetPortray(Number(value))}
            />
          </div>
        </section>

        <div className="editor-actions">
          <Btn variant="primary" onClick={onClose}>
            {t("done")}
          </Btn>
        </div>
      </div>
    </Overlay>
  );
}
