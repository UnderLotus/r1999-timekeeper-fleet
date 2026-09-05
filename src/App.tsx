import { Github } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CharacterEditor } from "./components/CharacterEditor";
import { AppDialogs, type DialogState } from "./components/AppDialogs";
import { ExportCanvas } from "./components/ExportCanvas";
import type { ExportMode } from "./types/export";
import { PoolControls } from "./components/PoolControls";
import { PoolGrid } from "./components/PoolGrid";
import { SkinPicker } from "./components/SkinPicker";
import { TeamBoard } from "./components/TeamBoard";
import { TopBar } from "./components/TopBar";
import { getUiText } from "./i18n/ui";
import { onHydrated, useBoxStore } from "./store/boxStore";
import type { BoxStore } from "./store/boxStore";
import type { Profile } from "./types/profile";
import { assetSrc } from "./utils/assets";
import { createExportJob, type ExportJob } from "./utils/export-job";
import {
  getCharacter,
  profileHasFutureContent,
} from "./utils/catalog";
import { characterRefs, psychubeRefs } from "./utils/profile-mutations";
import { createPoolView } from "./utils/pool-model";
import type { AnchorRect } from "./utils/design";
import {
  createBrowserSharePreviewSession,
  type SharePreviewSession,
  type SharePreviewStoreState,
} from "./utils/share-preview-session";
import { consumeStorageError, STORAGE_ERROR_EVENT } from "./utils/storage";
import "./styles/tokens.css";
import "./styles/design-system.css";
import "./styles/global.css";
import "./styles/layout.css";
import "./styles/overlay.css";
import "./styles/insight-glyph.css";
import "./styles/character-card.css";
import "./styles/team-slot.css";
import "./styles/export-canvas.css";

const SITE_URL = "https://underlotus.github.io";

type EditorState = {
  id: string;
  field: "all" | "level" | "resonance";
  anchor: AnchorRect;
} | null;
type SkinState = { id: string; anchor: AnchorRect } | null;
function toSharePreviewState(state: BoxStore): SharePreviewStoreState {
  return {
    profile: state.profile,
    previewProfile: state.previewProfile,
    previewShowFutureSight: state.previewShowFutureSight,
    localShowFutureSight: state.preferences.showFutureSight,
  };
}
const sharePreviewStore = {
  getState: () => toSharePreviewState(useBoxStore.getState()),
  subscribe: (listener: (state: SharePreviewStoreState) => void) =>
    useBoxStore.subscribe((state) => listener(toSharePreviewState(state))),
  enterPreview: (profile: Profile, showFutureSight: boolean) =>
    useBoxStore.getState().enterPreview(profile, showFutureSight),
  setPreviewShowFutureSight: (value: boolean) =>
    useBoxStore.getState().setPreviewShowFutureSight(value),
  exitPreview: () => useBoxStore.getState().exitPreview(),
  importPreview: (enableFutureSight: boolean) =>
    useBoxStore.getState().importPreview(enableFutureSight),
};
export default function App(): React.JSX.Element {
  const store = useBoxStore();
  const shareSessionRef = useRef<SharePreviewSession | null>(null);
  if (shareSessionRef.current === null)
    shareSessionRef.current = createBrowserSharePreviewSession(
      sharePreviewStore,
      onHydrated,
    );
  const shareSession = shareSessionRef.current;
  const { profile, previewProfile, ui, preferences } = store;
  const isPreviewActive = previewProfile !== null;
  const activeProfile = previewProfile ?? profile;
  const [editor, setEditor] = useState<EditorState>(null),
    [skin, setSkin] = useState<SkinState>(null),
    [dialog, setDialog] = useState<DialogState>(null),
    [storageWarning, setStorageWarning] = useState(false),
    [shareError, setShareError] = useState(false),
    [futureNotice, setFutureNotice] = useState(false),
    [shareCopied, setShareCopied] = useState(false),
    [exportMode, setExportMode] = useState<ExportMode>("both"),
    [mobileView, setMobileView] = useState<"teams" | "pool">("teams");
  const exportRef = useRef<HTMLDivElement>(null),
    exportJobRef = useRef<ExportJob | null>(null),
    exportLifecycleRef = useRef(0),
    shareCopiedTimer = useRef<number | null>(null);
  if (exportJobRef.current === null)
    exportJobRef.current = createExportJob({
      getTarget: () => exportRef.current,
    });
  const exportJob = exportJobRef.current,
    exportState = useSyncExternalStore(
      exportJob.subscribe,
      exportJob.getState,
      exportJob.getState,
    ),
    lang = preferences.lang,
    t = (key: string, params?: Record<string, string | number>) =>
      getUiText(lang, key, params),
    revealFuture = isPreviewActive
      ? store.previewShowFutureSight
      : preferences.showFutureSight;
  const importInfo = shareSession.getImportInfo();
  const poolView = createPoolView({
    profile: activeProfile,
    tab: ui.tab,
    search: ui.search,
    filterMode: ui.filterMode,
    rarityFilter: ui.rarityFilter,
    revealFuture,
  });
  const psychubeOwnershipStatus = poolView.psychubeOwnership.status;
  useEffect(() => {
    document.title = t("appTitle");
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(
    () =>
      onHydrated(() => {
        useBoxStore.getState().initializeLanguage(navigator.language);
      }),
    [],
  );
  useEffect(() => {
    const warning = () => setStorageWarning(true);
    window.addEventListener(STORAGE_ERROR_EVENT, warning);
    if (consumeStorageError()) setStorageWarning(true);
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, warning);
  }, []);
  useEffect(
    () => () => {
      if (shareCopiedTimer.current !== null)
        window.clearTimeout(shareCopiedTimer.current);
    },
    [],
  );
  useEffect(
    () =>
      shareSession.start((event) => {
        if (event.kind === "invalid") setShareError(true);
        else setDialog({ kind: "preview-spoiler" });
      }),
    [shareSession],
  );
  useEffect(() => {
    const lifecycle = ++exportLifecycleRef.current;
    return () => {
      // React StrictMode rehearses an effect cleanup before its second setup.
      window.setTimeout(() => {
        if (exportLifecycleRef.current === lifecycle) exportJob.dispose();
      });
    };
  }, [exportJob]);
  const editorDef = editor ? getCharacter(editor.id) : undefined,
    editorBuild = editor ? activeProfile.characters[editor.id] : undefined,
    skinDef = skin ? getCharacter(skin.id) : undefined,
    skinBuild = skin ? activeProfile.characters[skin.id] : undefined;
  const copyShare = async () => {
    const result = await shareSession.copyCurrent();
    if (!result.copied) {
      setDialog({ kind: "share", url: result.url });
      return;
    }
    if (shareCopiedTimer.current !== null)
      window.clearTimeout(shareCopiedTimer.current);
    setShareCopied(true);
    shareCopiedTimer.current = window.setTimeout(() => {
      setShareCopied(false);
      shareCopiedTimer.current = null;
    }, 1600);
  };
  const startExport = () => {
    exportJob.start({
      profile: activeProfile,
      lang,
      mode: exportMode,
      revealFuture,
    });
  };
  const leavePreview = () => {
    shareSession.leavePreview();
  };
  const endAssignment = () => {
    store.setAssignment(null);
  };
  const beginAssignment = (
    team: number,
    slot: number,
    kind: "character" | "psychube",
    psychubeIndex: 0 | 1,
  ) => {
    store.setAssignment({ team, slot, kind, psychubeIndex });
    setMobileView("pool");
  };
  return (
    <main className="app-shell">
      <TopBar
        lang={lang}
        showFutureSight={revealFuture}
        shareCopied={shareCopied}
        exportDisabled={exportState.status === "working"}
        onLang={store.setLang}
        onFuture={() => {
          if (isPreviewActive) {
            if (store.previewShowFutureSight) {
              shareSession.setPreviewFutureSight(false);
            } else {
              setDialog({ kind: "preview-future-warning" });
            }
            return;
          }
          if (preferences.showFutureSight) {
            store.setShowFutureSight(false);
            if (profileHasFutureContent(profile)) {
              setFutureNotice(true);
              window.setTimeout(() => setFutureNotice(false), 3000);
            }
          } else {
            setDialog({ kind: "future-warning" });
          }
        }}
        onReset={() => setDialog({ kind: "reset" })}
        onShare={() => void copyShare()}
        onExport={() => {
          if (exportState.status !== "working") setDialog({ kind: "export" });
        }}
      />
      {storageWarning && (
        <div className="storage-warn" role="alert">
          {t("storageWarning")}
        </div>
      )}
      {futureNotice && (
        <div className="future-notice" role="status">
          {t("futureHiddenNotice")}
        </div>
      )}
      {shareError && (
        <button
          type="button"
          className="storage-warn"
          role="alert"
          onClick={() => setShareError(false)}
        >
          {t("shareInvalid")}
        </button>
      )}
      {isPreviewActive && (
        <div className="preview-banner">
          <strong>{t("previewBanner")}</strong>
          <button type="button" onClick={() => setDialog({ kind: "import" })}>
            {t("importProfile")}
          </button>
          <button type="button" onClick={leavePreview}>
            {t("backToLocal")}
          </button>
        </div>
      )}
      <nav className="mobile-view-switcher" aria-label={t("sections")}>
        <button
          type="button"
          data-active={mobileView === "teams"}
          aria-pressed={mobileView === "teams"}
          onClick={() => setMobileView("teams")}
        >
          {t("teams")}
        </button>
        <button
          type="button"
          data-active={mobileView === "pool" && ui.tab === "characters"}
          aria-pressed={mobileView === "pool" && ui.tab === "characters"}
          onClick={() => {
            store.setTab("characters");
            setMobileView("pool");
          }}
        >
          {t("tabCharacters")}
        </button>
        <button
          type="button"
          data-active={mobileView === "pool" && ui.tab === "psychubes"}
          aria-pressed={mobileView === "pool" && ui.tab === "psychubes"}
          onClick={() => {
            store.setTab("psychubes");
            setMobileView("pool");
          }}
        >
          {t("tabPsychubes")}
        </button>
      </nav>
      <div
        className="mobile-view mobile-view--teams"
        data-mobile-active={mobileView === "teams"}
      >
        <TeamBoard
          profile={activeProfile}
          lang={lang}
          revealFuture={revealFuture}
          assignment={ui.assignment}
          onSlotClick={(team, slot, kind, psychubeIndex = 0) => {
            if (
              ui.assignment?.team === team &&
              ui.assignment.slot === slot &&
              ui.assignment.kind === kind &&
              (kind !== "psychube" ||
                (ui.assignment.psychubeIndex ?? 0) === psychubeIndex)
            )
              endAssignment();
            else beginAssignment(team, slot, kind, psychubeIndex);
          }}
          onSwap={store.swapSlots}
          onClearSlot={(team, slot) =>
            store.assignSlot(team, slot, null, null, null)
          }
          onTeamName={store.setTeamName}
          onClearTeam={(team) => {
            if (
              activeProfile.teams[team].slots.some((slot) => slot.characterId)
            )
              setDialog({ kind: "clear-team", team });
          }}
        />
      </div>
      {ui.assignment && (
        <div className="assignment-bar">
          <span>
            {t("assignmentBar", {
              t: ui.assignment.team + 1,
              s: ui.assignment.slot + 1,
              kind: t(
                ui.assignment.kind === "character"
                  ? "assignCharacter"
                  : "assignPsychube",
              ),
            })}
          </span>
          <button type="button" onClick={endAssignment}>
            {t("cancel")}
          </button>
        </div>
      )}
      <section
        className="paper pool-panel mobile-view mobile-view--pool"
        data-mobile-active={mobileView === "pool"}
      >
        <PoolControls
          lang={lang}
          tab={ui.tab}
          search={ui.search}
          filterMode={ui.filterMode}
          rarityFilter={ui.rarityFilter}
          addDefaults={preferences.addDefaults}
          defaultSkinMode={preferences.defaultSkinMode}
          psychubeImprintDefault={preferences.psychubeImprintDefault}
          psychubeOwnershipStatus={psychubeOwnershipStatus}
          rarityOptions={poolView.rarityOptions}
          onTab={store.setTab}
          onSearch={store.setSearch}
          onFilter={store.setFilterMode}
          onRarity={store.setRarityFilter}
          onDefaults={store.setAddDefaults}
          onDefaultSkinMode={store.setDefaultSkinMode}
          onPsychubeImprintDefault={store.setPsychubeImprintDefault}
          onSetAllPsychubesOwned={store.setAllPsychubesOwned}
        />
        <PoolGrid
          view={poolView}
          lang={lang}
          revealFuture={revealFuture}
          assignment={ui.assignment}
          onAddCharacter={store.addCharacter}
          onOpenEditor={(id, field, anchor) => setEditor({ id, field, anchor })}
          onOpenSkin={(id, anchor) => setSkin({ id, anchor })}
          onSetInsight={store.setInsight}
          onSetResonance={store.setResonance}
          onRemoveCharacter={(id) =>
            characterRefs(activeProfile, id).length
              ? setDialog({ kind: "remove-char", id })
              : store.removeCharacter(id)
          }
          onPickCharacter={(id) => {
            const target = ui.assignment;
            if (!target) return;
            const old = activeProfile.teams[target.team].slots[target.slot];
            if (
              store.assignSlot(
                target.team,
                target.slot,
                id,
                old.psychubeId,
                old.psychubeId2,
              )
            ) {
              endAssignment();
              setMobileView("teams");
            }
          }}
          onPickPsychube={(id) => {
            const target = ui.assignment;
            if (!target) return;
            const old = activeProfile.teams[target.team].slots[target.slot];
            if (
              store.assignSlot(
                target.team,
                target.slot,
                old.characterId,
                (target.psychubeIndex ?? 0) === 0 ? id : old.psychubeId,
                (target.psychubeIndex ?? 0) === 1 ? id : old.psychubeId2,
              )
            ) {
              endAssignment();
              setMobileView("teams");
            }
          }}
          onSetPsychubeImprint={store.setPsychubeImprint}
          onRemovePsychube={(id) =>
            psychubeRefs(activeProfile, id).length
              ? setDialog({ kind: "remove-psy", id })
              : store.removePsychube(id)
          }
          onAddPsychube={store.addPsychube}
        />
      </section>
      <footer className="page-footer">
        <a
          className="repo-banner"
          href={SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          title={t("underLotusHome")}
        >
          <Github size={22} strokeWidth={1.5} aria-hidden="true" />
          <span className="repo-banner__text">
            <span className="repo-banner__name">underlotus</span>
            <span className="repo-banner__url">
              {SITE_URL.replace("https://", "")}
            </span>
          </span>
        </a>
        <a
          className="support-banner"
          href="https://ko-fi.com/H2Y624M8O8"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("supportKoFi")}
        >
          <img src={assetSrc("/assets/ui/kofi.png")} alt={t("supportKoFi")} />
        </a>
      </footer>
      {editorDef && editorBuild && editor && (
        <CharacterEditor
          def={editorDef}
          build={editorBuild}
          lang={lang}
          anchor={editor.anchor}
          initialField={editor.field}
          onClose={() => setEditor(null)}
          onSetInsight={(value) => store.setInsight(editor.id, value)}
          onSetLevel={(value) => store.setLevel(editor.id, value)}
          onSetResonance={(value) => store.setResonance(editor.id, value)}
          onSetPortray={(value) => store.setPortray(editor.id, value)}
        />
      )}{" "}
      {skinDef && skinBuild && skin && (
        <SkinPicker
          def={skinDef}
          activeVariant={skinBuild.activeVariant}
          lang={lang}
          revealFuture={revealFuture}
          anchor={skin.anchor}
          onSelect={(value) => store.setActiveVariant(skin.id, value)}
          onClose={() => setSkin(null)}
        />
      )}{" "}
      <AppDialogs
        dialog={dialog}
        setDialog={setDialog}
        activeProfile={activeProfile}
        lang={lang}
        exportMode={exportMode}
        setExportMode={setExportMode}
        exportBusy={exportState.status === "working"}
        importHasFutureContent={importInfo?.hasFutureContent ?? false}
        importLocalFutureSight={importInfo?.localFutureSightEnabled ?? false}
        onPreviewSpoilerConfirm={() => {
          shareSession.confirmIncomingPreview(true);
        }}
        onPreviewSpoilerCancel={shareSession.cancelIncomingPreview}
        onPreviewFutureConfirm={() => {
          shareSession.setPreviewFutureSight(true);
        }}
        onImportPreview={shareSession.importPreview}
        onExport={startExport}
      />
      {exportState.status === "working" && (
        <div className="export-status" role="status">
          {exportState.progress?.phase === "loading" &&
          exportState.progress.total > 0
            ? t("exportProgress", {
                loaded: exportState.progress.loaded,
                total: exportState.progress.total,
              })
            : t("exportWorking")}
        </div>
      )}
      {exportState.status === "error" && (
        <button
          type="button"
          className="export-error"
          onClick={exportJob.dismissError}
        >
          {t("exportError")}
        </button>
      )}
      {exportState.snapshot && (
        <div className="export-layer" ref={exportRef} aria-hidden="true">
          <ExportCanvas {...exportState.snapshot} />
        </div>
      )}
    </main>
  );
}
