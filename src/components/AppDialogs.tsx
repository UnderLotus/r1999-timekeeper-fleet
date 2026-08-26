import type { Dispatch, SetStateAction } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { ShareDialog } from "./ShareDialog";
import type { ExportMode } from "../types/export";
import { getUiText, type LangCode } from "../i18n/ui";
import { useBoxStore } from "../store/boxStore";
import type { Profile } from "../types/profile";
import { characterName, getCharacter } from "../utils/catalog";

export type DialogState =
  | { kind: "reset" }
  | { kind: "future-warning" }
  | { kind: "preview-future-warning" }
  | { kind: "preview-spoiler" }
  | { kind: "import" }
  | { kind: "remove-char"; id: string }
  | { kind: "remove-psy"; id: string }
  | { kind: "clear-team"; team: number }
  | { kind: "share"; url: string }
  | { kind: "export" }
  | null;

export function AppDialogs({
  dialog,
  setDialog,
  activeProfile,
  lang,
  exportMode,
  setExportMode,
  exportBusy,
  importHasFutureContent,
  importLocalFutureSight,
  onPreviewSpoilerConfirm,
  onPreviewSpoilerCancel,
  onPreviewFutureConfirm,
  onImportPreview,
  onExport,
}: {
  dialog: DialogState;
  setDialog: Dispatch<SetStateAction<DialogState>>;
  activeProfile: Profile;
  lang: LangCode;
  exportMode: ExportMode;
  setExportMode: Dispatch<SetStateAction<ExportMode>>;
  exportBusy: boolean;
  importHasFutureContent: boolean;
  importLocalFutureSight: boolean;
  onPreviewSpoilerConfirm: () => void;
  onPreviewSpoilerCancel: () => void;
  onPreviewFutureConfirm: () => void;
  onImportPreview: (enableFutureSight: boolean) => void;
  onExport: () => void;
}): React.JSX.Element {
  const store = useBoxStore();
  const t = (key: string, params?: Record<string, string | number>) =>
    getUiText(lang, key, params);
  const close = () => setDialog(null);
  return (
    <>
      {dialog?.kind === "future-warning" && (
        <ConfirmDialog
          open
          title={t("futureWarningTitle")}
          body={t("futureWarningBody")}
          lang={lang}
          onConfirm={() => {
            store.setShowFutureSight(true);
            close();
          }}
          onCancel={close}
        />
      )}
      {dialog?.kind === "preview-future-warning" && (
        <ConfirmDialog
          open
          title={t("futureWarningTitle")}
          body={t("futureWarningBody")}
          lang={lang}
          onConfirm={() => {
            onPreviewFutureConfirm();
            close();
          }}
          onCancel={close}
        />
      )}
      {dialog?.kind === "preview-spoiler" && (
        <ConfirmDialog
          open
          title={t("futureWarningTitle")}
          body={t("previewFutureBody")}
          lang={lang}
          confirmLabel={t("revealPreview")}
          onConfirm={() => {
            onPreviewSpoilerConfirm();
            close();
          }}
          onCancel={() => {
            onPreviewSpoilerCancel();
            close();
          }}
        />
      )}
      {dialog?.kind === "reset" && (
        <ConfirmDialog
          open
          title={t("confirmResetTitle")}
          body={t("confirmResetBody")}
          lang={lang}
          danger
          onConfirm={() => {
            store.resetAll();
            close();
          }}
          onCancel={close}
        />
      )}
      {dialog?.kind === "clear-team" && (
        <ConfirmDialog
          open
          title={t("clearTeamTitle")}
          body={t("clearTeamBody", { n: dialog.team + 1 })}
          lang={lang}
          danger
          onConfirm={() => {
            store.clearTeam(dialog.team);
            close();
          }}
          onCancel={close}
        />
      )}
      {dialog?.kind === "remove-char" && (
        <ConfirmDialog
          open
          title={t("removeCharTitle")}
          body={t("removeCharBody", {
            name: characterName(getCharacter(dialog.id)!, lang),
          })}
          lang={lang}
          danger
          onConfirm={() => {
            store.removeCharacter(dialog.id);
            close();
          }}
          onCancel={close}
        />
      )}
      {dialog?.kind === "remove-psy" && (
        <ConfirmDialog
          open
          title={t("removePsychubeTitle")}
          body={t("removePsychubeBody")}
          lang={lang}
          danger
          onConfirm={() => {
            store.removePsychube(dialog.id);
            close();
          }}
          onCancel={close}
        />
      )}
      {dialog?.kind === "import" && (
        <ConfirmDialog
          open
          title={t("confirmImportTitle")}
          body={
            importHasFutureContent && !importLocalFutureSight
              ? t("confirmImportFutureBody", {
                  c: Object.keys(activeProfile.characters).length,
                  p: Object.keys(activeProfile.psychubes).length,
                })
              : t("confirmImportBody", {
                  c: Object.keys(activeProfile.characters).length,
                  p: Object.keys(activeProfile.psychubes).length,
                })
          }
          lang={lang}
          confirmLabel={
            importHasFutureContent && !importLocalFutureSight
              ? t("importKeepHidden")
              : t("confirm")
          }
          secondaryConfirmLabel={
            importHasFutureContent && !importLocalFutureSight
              ? t("importEnableFuture")
              : undefined
          }
          onConfirm={() => {
            onImportPreview(false);
            close();
          }}
          onSecondaryConfirm={() => {
            onImportPreview(true);
            close();
          }}
          onCancel={close}
        />
      )}
      {dialog?.kind === "share" && (
        <ShareDialog url={dialog.url} lang={lang} onClose={close} />
      )}
      {dialog?.kind === "export" && (
        <ConfirmDialog
          open
          title={t("exportTitle")}
          body={t("exportModeLabel")}
          lang={lang}
          confirmDisabled={exportBusy}
          onConfirm={() => {
            onExport();
            close();
          }}
          onCancel={close}
        >
          <div className="export-mode-picker">
            {(["teams", "pool", "both"] as ExportMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`ds-btn ds-btn--sm ${exportMode === mode ? "ds-btn--primary" : "ds-btn--neutral"}`}
                onClick={() => setExportMode(mode)}
              >
                {t(
                  mode === "teams"
                    ? "exportTeams"
                    : mode === "pool"
                      ? "exportPool"
                      : "exportBoth",
                )}
              </button>
            ))}
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
