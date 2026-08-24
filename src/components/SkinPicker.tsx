import type { LangCode } from "../i18n/ui";
import { getUiText } from "../i18n/ui";
import type { CharacterDef, SkinVariant } from "../types/catalog";
import type { AnchorRect } from "../utils/design";
import { cx } from "../utils/design";
import { ResponsivePopover } from "./ResponsivePopover";
import { AssetIcon } from "./AssetIcon";
export function SkinPicker({
  def,
  activeVariant,
  lang,
  revealFuture,
  anchor,
  onSelect,
  onClose,
}: {
  def: CharacterDef;
  activeVariant: string | null;
  lang: LangCode;
  revealFuture: boolean;
  anchor?: AnchorRect;
  onSelect: (id: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const t = (key: string) => getUiText(lang, key),
    label = (skin: SkinVariant) =>
      skin.name ??
      skin.nameEn ??
      (skin.type === "default"
        ? t("skinDefault")
        : skin.type === "insight"
          ? t("skinInsight")
          : skin.id);
  const visible = def.skins.filter(
    (skin) => revealFuture || skin.released !== false,
  );
  return (
    <ResponsivePopover
      title={`${t("skin")} · ${def.names[lang]}`}
      closeLabel={t("close")}
      onClose={onClose}
      anchor={anchor}
      className="skin-picker-panel"
    >
      <div className="skin-picker__grid">
        {visible.map((skin) => (
          <button
            key={skin.id}
            type="button"
            className={cx(
              "skin-picker__item",
              (activeVariant ?? def.defaultVariant) === skin.id &&
                "is-selected",
            )}
            aria-pressed={(activeVariant ?? def.defaultVariant) === skin.id}
            onClick={() => {
              onSelect(skin.id);
              onClose();
            }}
          >
            <AssetIcon kind="character" id={skin.id} alt={label(skin)} />
            <span className="skin-picker__item-label">{label(skin)}</span>
          </button>
        ))}
      </div>
    </ResponsivePopover>
  );
}
