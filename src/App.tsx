import { Github } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CharacterEditor } from "./components/CharacterEditor";
import { AppDialogs, type DialogState } from "./components/AppDialogs";
import { ExportCanvas } from "./components/ExportCanvas";
import type { ExportMode } from "./components/ExportCanvas";
import { PoolControls } from "./components/PoolControls";
import { PoolGrid } from "./components/PoolGrid";
import { SkinPicker } from "./components/SkinPicker";
import { TeamBoard } from "./components/TeamBoard";
import { TopBar } from "./components/TopBar";
import { getUiText } from "./i18n/ui";
import type { LangCode } from "./i18n/ui";
import {
  characterRefs,
  onHydrated,
  psychubeRefs,
  useBoxStore,
} from "./store/boxStore";
import type { FilterMode } from "./store/boxStore";
import type { Profile } from "./types/profile";
import { assetSrc } from "./utils/assets";
import type { ExportProgress } from "./utils/export-image";
import {
  allPsychubes,
  getCharacter,
  profileHasFutureContent,
} from "./utils/catalog";
import type { AnchorRect } from "./utils/design";
import {
  decodeSharePayload,
  encodeShareToken,
  payloadToProfile,
  profileToPayload,
} from "./utils/share-code";
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
interface ExportSnapshot {
  profile: Profile;
  lang: LangCode;
  mode: ExportMode;
  revealFuture: boolean;
}
function profileFromHash(): Profile | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, "")),
    token = params.get("p");
  if (!token) return null;
  const payload = decodeSharePayload(token);
  return payload ? payloadToProfile(payload) : null;
}
function setHash(profile: Profile | null): void {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (profile) params.set("p", encodeShareToken(profileToPayload(profile)));
  else params.delete("p");
  const hash = params.toString();
  history.replaceState(
    null,
    "",
    location.pathname + location.search + (hash ? `#${hash}` : ""),
  );
}
function shareUrl(profile: Profile): string {
  return `${location.origin}${location.pathname}${location.search}#p=${encodeShareToken(profileToPayload(profile))}`;
}
function cloneProfile(profile: Profile): Profile {
  return JSON.parse(JSON.stringify(profile)) as Profile;
}
export default function App(): React.JSX.Element {
  const store = useBoxStore();
  const { profile, previewProfile, activeIsPreview, ui, preferences } = store;
  const activeProfile =
    activeIsPreview && previewProfile ? previewProfile : profile;
  const [editor, setEditor] = useState<EditorState>(null),
    [skin, setSkin] = useState<SkinState>(null),
    [dialog, setDialog] = useState<DialogState>(null),
    [storageWarning, setStorageWarning] = useState(false),
    [shareError, setShareError] = useState(false),
    [futureNotice, setFutureNotice] = useState(false),
    [shareCopied, setShareCopied] = useState(false),
    [exportMode, setExportMode] = useState<ExportMode>("both"),
    [exportSnapshot, setExportSnapshot] = useState<ExportSnapshot | null>(null),
    [exportProgress, setExportProgress] = useState<ExportProgress | null>(null),
    [mobileView, setMobileView] = useState<"teams" | "pool">("teams"),
    [exportStatus, setExportStatus] = useState<"idle" | "working" | "error">(
      "idle",
    );
  const exportRef = useRef<HTMLDivElement>(null),
    exportInFlight = useRef(false),
    handledHash = useRef<string | null>(null),
    assignmentPreviousFilter = useRef<FilterMode | null>(null),
    lang = preferences.lang,
    t = (key: string, params?: Record<string, string | number>) =>
      getUiText(lang, key, params),
    revealFuture = activeIsPreview
      ? store.previewShowFutureSight
      : preferences.showFutureSight;
  const visiblePsychubes = allPsychubes().filter(
      (definition) => definition.released || revealFuture,
    ),
    ownedVisiblePsychubes = visiblePsychubes.filter(
      (definition) => activeProfile.psychubes[definition.id],
    ).length,
    psychubeOwnershipStatus =
      ownedVisiblePsychubes === 0
        ? ("unowned" as const)
        : ownedVisiblePsychubes === visiblePsychubes.length
          ? ("owned" as const)
          : null;
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
  useEffect(() => {
    let removeHashListener = () => {};
    const unsubscribe = onHydrated(() => {
      const open = () => {
        if (!location.hash.includes("p=")) return;
        if (handledHash.current === location.hash) return;
        handledHash.current = location.hash;
        const incoming = profileFromHash();
        if (!incoming) {
          setHash(null);
          setShareError(true);
          return;
        }
        if (profileHasFutureContent(incoming))
          setDialog({ kind: "preview-spoiler", profile: incoming });
        else {
          useBoxStore.getState().enterPreview(incoming, false);
        }
      };
      open();
      window.addEventListener("hashchange", open);
      removeHashListener = () => window.removeEventListener("hashchange", open);
    });
    return () => {
      unsubscribe();
      removeHashListener();
    };
  }, []);
  useEffect(() => {
    if (!activeIsPreview || !previewProfile) return;
    const timer = window.setTimeout(() => setHash(previewProfile), 180);
    return () => clearTimeout(timer);
  }, [activeIsPreview, previewProfile]);
  useEffect(() => {
    if (!exportSnapshot) return;
    let cancelled = false;
    const run = async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (cancelled) return;
      try {
        const { exportJpeg } = await import("./utils/export-image");
        const element = exportRef.current;
        if (!element) throw new Error("Export canvas is unavailable");
        await exportJpeg(element, (value) => {
          if (!cancelled) setExportProgress(value);
        });
        if (!cancelled) setExportStatus("idle");
      } catch (error) {
        console.error(error);
        if (!cancelled) setExportStatus("error");
      } finally {
        exportInFlight.current = false;
        if (!cancelled) setExportSnapshot(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [exportSnapshot]);
  const editorDef = editor ? getCharacter(editor.id) : undefined,
    editorBuild = editor ? activeProfile.characters[editor.id] : undefined,
    skinDef = skin ? getCharacter(skin.id) : undefined,
    skinBuild = skin ? activeProfile.characters[skin.id] : undefined;
  const copyShare = async () => {
    const url = shareUrl(activeProfile);
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1600);
    } catch {
      setDialog({ kind: "share", url });
    }
  };
  const startExport = () => {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    setExportProgress(null);
    setExportStatus("working");
    setExportSnapshot({
      profile: cloneProfile(activeProfile),
      lang,
      mode: exportMode,
      revealFuture,
    });
  };
  const leavePreview = () => {
    setHash(null);
    handledHash.current = null;
    store.exitPreview();
  };
  const endAssignment = () => {
    const previousFilter = assignmentPreviousFilter.current;
    assignmentPreviousFilter.current = null;
    store.setAssignment(null);
    if (previousFilter !== null) store.setFilterMode(previousFilter);
  };
  const beginAssignment = (
    team: number,
    slot: number,
    kind: "character" | "psychube",
    psychubeIndex: 0 | 1,
  ) => {
    if (!ui.assignment) assignmentPreviousFilter.current = ui.filterMode;
    store.setAssignment({ team, slot, kind, psychubeIndex });
    store.setTab(kind === "character" ? "characters" : "psychubes");
    store.setFilterMode("owned");
    setMobileView("pool");
  };
  return (
    <main className="app-shell">
      <TopBar
        lang={lang}
        showFutureSight={revealFuture}
        shareCopied={shareCopied}
        exportDisabled={exportStatus === "working"}
        onLang={store.setLang}
        onFuture={() => {
          if (activeIsPreview) {
            if (store.previewShowFutureSight) {
              store.setPreviewShowFutureSight(false);
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
          if (!exportInFlight.current) setDialog({ kind: "export" });
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
      {activeIsPreview && (
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
          tab={ui.tab}
          lang={lang}
          revealFuture={revealFuture}
          ownedCharacters={activeProfile.characters}
          psychubes={activeProfile.psychubes}
          search={ui.search}
          filterMode={ui.filterMode}
          rarityFilter={ui.rarityFilter}
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
        exportBusy={exportStatus === "working"}
        onClearShareHash={() => setHash(null)}
        onExport={startExport}
      />
      {exportStatus === "working" && (
        <div className="export-status" role="status">
          {exportProgress?.phase === "loading" && exportProgress.total > 0
            ? t("exportProgress", {
                loaded: exportProgress.loaded,
                total: exportProgress.total,
              })
            : t("exportWorking")}
        </div>
      )}
      {exportStatus === "error" && (
        <button
          type="button"
          className="export-error"
          onClick={() => {
            setExportStatus("idle");
            setExportProgress(null);
          }}
        >
          {t("exportError")}
        </button>
      )}
      {exportSnapshot && (
        <div className="export-layer" ref={exportRef} aria-hidden="true">
          <ExportCanvas {...exportSnapshot} />
        </div>
      )}
    </main>
  );
}
