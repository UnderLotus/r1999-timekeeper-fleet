import { Shirt, X } from "lucide-react";
import { getUiText } from "../i18n/ui";
import type { LangCode } from "../i18n/ui";
import type { CharacterDef } from "../types/catalog";
import { RESONANCE_MAX, type CharacterBuild } from "../types/profile";
import { legalInsights } from "../utils/catalog";
import { cx, rectFromElement } from "../utils/design";
import { presentCharacter } from "../utils/presentation";
import type { AnchorRect } from "../utils/design";
import { AssetIcon } from "./AssetIcon";
import { InsightGlyph } from "./InsightGlyph";
import { PortraitPortray } from "./PortraitPortray";
import { ResonanceIcon } from "./ResonanceIcon";
export function CharacterCard({
  def,
  build,
  lang,
  revealFuture,
  onAdd,
  onOpenEditor,
  onOpenSkin,
  onRemove,
  onSetInsight,
  onSetResonance,
  onAssign,
}: {
  def: CharacterDef;
  build: CharacterBuild | undefined;
  lang: LangCode;
  revealFuture: boolean;
  onAdd: () => void;
  onOpenEditor: (
    field: "all" | "level" | "resonance",
    anchor: AnchorRect,
  ) => void;
  onOpenSkin: (anchor: AnchorRect) => void;
  onRemove: () => void;
  onSetInsight: (value: 0 | 1 | 2 | 3) => void;
  onSetResonance: (value: number) => void;
  onAssign?: () => void;
}): React.JSX.Element {
  const t = (key: string, params?: Record<string, string | number>) =>
      getUiText(lang, key, params),
    presentation = presentCharacter(
      def,
      build,
      lang,
      revealFuture,
      getUiText(lang, "hiddenFutureSlot"),
    ),
    owned = !!build,
    { name, variant } = presentation,
    nextInsight = build
      ? legalInsights(def).find((value) => value > build.insight)
      : undefined,
    nextResonance =
      build && build.resonance < RESONANCE_MAX
        ? build.resonance + 1
        : undefined;
  return (
    <article
      className={cx(
        "char-card",
        owned ? "char-card--owned" : "char-card--unowned",
      )}
    >
      <div className="char-card__portrait">
        <button
          type="button"
          className="char-card__main"
          aria-label={
            onAssign && owned
              ? t("assignCharacterNamed", { name })
              : owned
                ? t("editCharacterNamed", { name })
                : t("addCharacterNamed", { name })
          }
          onClick={(e) => {
            if (onAssign && owned) onAssign();
            else if (owned)
              onOpenEditor("all", rectFromElement(e.currentTarget));
            else onAdd();
          }}
        >
          <AssetIcon kind="character" id={variant.id} alt={name} />
        </button>
        {owned && build && !onAssign && <PortraitPortray build={build} />}{" "}
        {owned && !onAssign && (
          <button
            type="button"
            className="char-card__skin-btn"
            aria-label={t("openSkinNamed", { name })}
            onClick={(e) => {
              e.stopPropagation();
              onOpenSkin(rectFromElement(e.currentTarget));
            }}
          >
            <Shirt size={13} />
          </button>
        )}
        {owned && !onAssign && (
          <button
            type="button"
            className="remove-icon-btn char-card__remove"
            aria-label={t("removeCharacterNamed", { name })}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="char-card__name" title={name}>
        {name}
      </div>
      {owned && build && (
        <div className="char-card__level">LV. {build.level}</div>
      )}
      {owned && build && (
        <div
          className="char-card__meta"
          aria-label={`I${build.insight} ${getUiText(lang, "resonance")} ${build.resonance}`}
        >
          {onAssign ? (
            <span className="char-card__meta-item">
              <InsightGlyph insight={build.insight} />
            </span>
          ) : (
            <button
              type="button"
              className="char-card__meta-item char-card__meta-action"
              aria-label={`${getUiText(lang, "insight")} ${build.insight}${
                nextInsight === undefined
                  ? ` · ${getUiText(lang, "max")}`
                  : ` → ${nextInsight}`
              }`}
              disabled={nextInsight === undefined}
              onClick={() =>
                nextInsight !== undefined && onSetInsight(nextInsight)
              }
            >
              <InsightGlyph insight={build.insight} />
            </button>
          )}
          {onAssign ? (
            <span
              className="char-card__meta-item char-card__resonance resonance-stat"
              aria-label={`${getUiText(lang, "resonance")} ${build.resonance}`}
            >
              <ResonanceIcon size={14} aria-hidden="true" />
              {build.resonance}
            </span>
          ) : (
            <button
              type="button"
              className="char-card__meta-item char-card__meta-action char-card__resonance resonance-stat"
              aria-label={`${getUiText(lang, "resonance")} ${build.resonance}${
                nextResonance === undefined
                  ? ` · ${getUiText(lang, "max")}`
                  : ` → ${nextResonance}`
              }`}
              disabled={nextResonance === undefined}
              onClick={() =>
                nextResonance !== undefined && onSetResonance(nextResonance)
              }
            >
              <ResonanceIcon size={14} aria-hidden="true" />
              {build.resonance}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
