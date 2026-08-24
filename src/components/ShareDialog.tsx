import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { getUiText } from "../i18n/ui";
import type { LangCode } from "../i18n/ui";
import { Btn, Overlay } from "../utils/design";

/** 分享 URL 對話框：程式複製失敗時仍保留可選取的手動複製路徑。 */
export function ShareDialog(props: {
  url: string;
  lang: LangCode;
  onClose: () => void;
}): React.JSX.Element {
  const { url, lang, onClose } = props;
  const t = (key: string) => getUiText(lang, key);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.select());
    return () => {
      cancelAnimationFrame(frame);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copy = async () => {
    let success = false;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(url);
      success = true;
    } catch {
      const input = inputRef.current;
      input?.select();
      try {
        success = !!input && document.execCommand("copy");
      } catch {
        success = false;
      }
    }

    setCopied(success);
    setFailed(!success);
    if (!success) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Overlay title={t("share")} closeLabel={t("close")} onClose={onClose}>
      <div
        className="share-dialog"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        {failed && (
          <div
            className="share-dialog__fail"
            role="alert"
            style={{ color: "var(--danger)", fontSize: 12 }}
          >
            {t("copyFailed")}
          </div>
        )}
        <input
          ref={inputRef}
          className="share-dialog__url"
          type="text"
          readOnly
          value={url}
          aria-label={t("share")}
          onFocus={(event) => event.currentTarget.select()}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="teal" onClick={() => void copy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t("urlCopied") : t("copyUrl")}
          </Btn>
          <Btn variant="neutral" onClick={onClose}>
            {t("close")}
          </Btn>
        </div>
      </div>
    </Overlay>
  );
}
