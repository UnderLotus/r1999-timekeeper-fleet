import { Check, Eye, EyeOff, ImageDown, RotateCcw, Share2 } from "lucide-react";
import { getUiText } from "../i18n/ui";
import type { LangCode } from "../i18n/ui";
import { Btn } from "../utils/design";
import { LangSwitcher } from "./LangSwitcher";
export function TopBar({
  lang,
  showFutureSight,
  shareCopied,
  exportDisabled,
  onLang,
  onFuture,
  onReset,
  onShare,
  onExport,
}: {
  lang: LangCode;
  showFutureSight: boolean;
  shareCopied: boolean;
  exportDisabled: boolean;
  onLang: (lang: LangCode) => void;
  onFuture: () => void;
  onReset: () => void;
  onShare: () => void;
  onExport: () => void;
}): React.JSX.Element {
  const t = (key: string) => getUiText(lang, key);
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <span className="topbar__title">{t("appTitle")}</span>
      </div>
      <LangSwitcher value={lang} onChange={onLang} />
      <Btn
        variant="ghost"
        size="sm"
        className="topbar__future"
        aria-label={t("futureSight")}
        title={t("futureSight")}
        aria-pressed={showFutureSight}
        onClick={onFuture}
      >
        {showFutureSight ? <Eye size={15} /> : <EyeOff size={15} />}
        <span>{t("futureSight")}</span>
      </Btn>
      <Btn
        variant="neutral"
        size="sm"
        className="topbar__reset"
        onClick={onReset}
      >
        <RotateCcw size={15} />
        <span>{t("resetProfile")}</span>
      </Btn>
      <div className="topbar__export-actions">
        <Btn
          variant="teal"
          size="sm"
          className="topbar__share"
          onClick={onShare}
        >
          <Share2 size={15} />
          <span>{shareCopied ? t("urlCopied") : t("share")}</span>
        </Btn>
        <Btn
          variant="primary"
          size="sm"
          className="topbar__export"
          disabled={exportDisabled}
          onClick={onExport}
        >
          <ImageDown size={15} />
          <span>{t("export")}</span>
        </Btn>
      </div>
      {shareCopied && (
        <div
          className="share-copy-toast"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <Check size={16} aria-hidden="true" />
          <span>{t("urlCopied")}</span>
        </div>
      )}
    </header>
  );
}
