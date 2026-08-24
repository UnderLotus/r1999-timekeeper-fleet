import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { getUiText } from "../i18n/ui";
import type { LangCode } from "../i18n/ui";
export function ConfirmDialog({
  open,
  title,
  body,
  lang,
  confirmLabel,
  secondaryConfirmLabel,
  onConfirm,
  onSecondaryConfirm,
  onCancel,
  children,
  danger = false,
  confirmDisabled = false,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  lang: LangCode;
  confirmLabel?: string;
  secondaryConfirmLabel?: string;
  onConfirm: () => void;
  onSecondaryConfirm?: () => void;
  onCancel: () => void;
  children?: ReactNode;
  danger?: boolean;
  confirmDisabled?: boolean;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null),
    t = (key: string) => getUiText(lang, key);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
    >
      <strong className="confirm-dialog__title">{title}</strong>
      <div className="confirm-dialog__message">{body}</div>
      {children}
      <div className="confirm-dialog__actions">
        <button
          type="button"
          className="ds-btn ds-btn--neutral ds-btn--md"
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
        {secondaryConfirmLabel && onSecondaryConfirm && (
          <button
            type="button"
            className="ds-btn ds-btn--neutral ds-btn--md"
            onClick={onSecondaryConfirm}
          >
            {secondaryConfirmLabel}
          </button>
        )}
        <button
          type="button"
          className={`ds-btn ds-btn--md ${danger ? "ds-btn--danger" : "ds-btn--primary"}`}
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel ?? t("confirm")}
        </button>
      </div>
    </dialog>
  );
}
