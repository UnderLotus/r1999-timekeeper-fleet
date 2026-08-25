import { Minus, X } from "lucide-react";
import { getUiText, type LangCode } from "../i18n/ui";
import type { PsychubeDef } from "../types/catalog";
import { PSYCHUBE_IMPRINT_MAX } from "../types/profile";
import { psychubeName } from "../utils/catalog";
import { AssetIcon } from "./AssetIcon";
import { PsychubeAmplificationBadge } from "./PsychubeAmplificationBadge";

export function PsychubeCard({
  def,
  imprint,
  lang,
  onAdd,
  onSetImprint,
  onRemove,
  onAssign,
}: {
  def: PsychubeDef;
  imprint: number;
  lang: LangCode;
  onAdd: () => void;
  onSetImprint: (value: number) => void;
  onRemove: () => void;
  onAssign?: () => void;
}): React.JSX.Element {
  const name = psychubeName(def, lang),
    owned = imprint > 0,
    t = (key: string) => getUiText(lang, key),
    next = Math.min(PSYCHUBE_IMPRINT_MAX, imprint + 1),
    previous = Math.max(1, imprint - 1),
    atMax = owned && !onAssign && imprint >= PSYCHUBE_IMPRINT_MAX;

  return (
    <article
      className={`psy-card ${owned ? "psy-card--owned" : "psy-card--unowned"}`}
    >
      <button
        type="button"
        className="psy-card__main"
        aria-label={
          onAssign && owned
            ? `${t("assignPsychube")} · ${name}`
            : owned
              ? `${name} · ${t("psychubeImprint")} ${imprint}${atMax ? ` · ${t("max")}` : ` → ${next}`}`
              : `${name} · ${t("psychubeImprint")} 0 → 1`
        }
        aria-disabled={atMax || undefined}
        onClick={() => {
          if (onAssign && owned) onAssign();
          else if (!owned) onAdd();
          else if (!atMax) onSetImprint(next);
        }}
      >
        <span className="psy-card__frame">
          <AssetIcon kind="psychube" id={def.id} alt={name} />
          <PsychubeAmplificationBadge value={imprint} />
        </span>
        <span className="psy-card__name" title={name}>
          {name}
        </span>
      </button>
      {owned && !onAssign && (
        <button
          type="button"
          className="psy-card__action psy-card__decrease"
          aria-label={`${name} · ${t("psychubeImprint")} ${imprint} → ${previous}`}
          title={`${t("psychubeImprint")} −`}
          disabled={imprint <= 1}
          onClick={() => onSetImprint(previous)}
        >
          <Minus size={14} strokeWidth={2} />
        </button>
      )}
      {owned && !onAssign && (
        <button
          type="button"
          className="remove-icon-btn psy-card__remove"
          aria-label={`${t("remove")} ${name}`}
          onClick={onRemove}
        >
          <X size={12} />
        </button>
      )}
    </article>
  );
}
