import type { Profile } from "../types/profile";
import { profileHasFutureContent } from "./catalog";
import {
  decodeSharePayload,
  encodeShareToken,
  payloadToProfile,
  profileToPayload,
} from "./share-code";

export const SHARE_PREVIEW_SYNC_DELAY_MS = 180;

export interface SharePreviewStoreState {
  profile: Profile;
  previewProfile: Profile | null;
  activeIsPreview: boolean;
  previewShowFutureSight: boolean;
  localShowFutureSight: boolean;
}

export interface SharePreviewStore {
  getState: () => SharePreviewStoreState;
  subscribe: (listener: (state: SharePreviewStoreState) => void) => () => void;
  enterPreview: (profile: Profile, showFutureSight: boolean) => void;
  setPreviewShowFutureSight: (value: boolean) => void;
  exitPreview: () => void;
  importPreview: (enableFutureSight: boolean) => void;
}

export interface SharePreviewLocation {
  getHash: () => string;
  replaceHash: (hash: string) => void;
  shareBaseUrl: () => string;
  onHashChange: (listener: () => void) => () => void;
}

export interface SharePreviewClipboard {
  writeText: (url: string) => Promise<void>;
}

export interface SharePreviewClock {
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export type SharePreviewOpenResult =
  | { kind: "ignored" }
  | { kind: "invalid" }
  | { kind: "requires-spoiler" }
  | { kind: "entered" };

export type SharePreviewEvent =
  | { kind: "invalid" }
  | { kind: "requires-spoiler" };

export interface ShareCopyResult {
  url: string;
  copied: boolean;
}

export interface ShareImportInfo {
  hasFutureContent: boolean;
  localFutureSightEnabled: boolean;
}

export interface SharePreviewSession {
  start: (onEvent: (event: SharePreviewEvent) => void) => () => void;
  openFromHash: () => SharePreviewOpenResult;
  confirmIncomingPreview: (revealFuture: boolean) => boolean;
  cancelIncomingPreview: () => void;
  setPreviewFutureSight: (value: boolean) => void;
  clearShareHash: () => void;
  leavePreview: () => void;
  importPreview: (enableFutureSight: boolean) => void;
  copyCurrent: () => Promise<ShareCopyResult>;
  getImportInfo: () => ShareImportInfo | null;
}

interface SharePreviewSessionOptions {
  store: SharePreviewStore;
  location: SharePreviewLocation;
  clipboard: SharePreviewClipboard;
  ready?: (callback: () => void) => () => void;
  clock?: SharePreviewClock;
  syncDelayMs?: number;
}

const browserClock: SharePreviewClock = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function readHashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ""));
}

function activeProfile(state: SharePreviewStoreState): Profile {
  return state.activeIsPreview && state.previewProfile
    ? state.previewProfile
    : state.profile;
}

export function createSharePreviewSession(
  options: SharePreviewSessionOptions,
): SharePreviewSession {
  const clock = options.clock ?? browserClock;
  const syncDelayMs = options.syncDelayMs ?? SHARE_PREVIEW_SYNC_DELAY_MS;
  let pendingIncoming: Profile | null = null;
  let handledHash: string | null = null;
  let syncTimer: unknown = null;
  let observedPreviewProfile: Profile | null = null;
  let started = false;
  let stopReady = () => {};
  let stopRuntime: (() => void) | null = null;

  const clearSyncTimer = (): void => {
    if (syncTimer === null) return;
    clock.clearTimeout(syncTimer);
    syncTimer = null;
  };

  const replaceEncodedProfile = (profile: Profile): void => {
    const params = readHashParams(options.location.getHash());
    params.set("p", encodeShareToken(profileToPayload(profile)));
    options.location.replaceHash(params.toString());
  };

  const scheduleProfileSync = (profile: Profile): void => {
    clearSyncTimer();
    syncTimer = clock.setTimeout(() => {
      syncTimer = null;
      const state = options.store.getState();
      if (
        pendingIncoming === null &&
        state.activeIsPreview &&
        state.previewProfile === profile
      )
        replaceEncodedProfile(profile);
    }, syncDelayMs);
  };

  const clearShareHash = (): void => {
    clearSyncTimer();
    pendingIncoming = null;
    handledHash = null;
    observedPreviewProfile = null;
    const params = readHashParams(options.location.getHash());
    params.delete("p");
    options.location.replaceHash(params.toString());
  };

  const openFromHash = (): SharePreviewOpenResult => {
    const hash = options.location.getHash();
    const params = readHashParams(hash);
    const token = params.get("p");
    if (!token) {
      pendingIncoming = null;
      return { kind: "ignored" };
    }
    if (handledHash === hash) return { kind: "ignored" };
    handledHash = hash;
    const payload = decodeSharePayload(token);
    if (!payload) {
      clearShareHash();
      return { kind: "invalid" };
    }
    const incoming = payloadToProfile(payload);
    if (profileHasFutureContent(incoming)) {
      clearSyncTimer();
      pendingIncoming = incoming;
      return { kind: "requires-spoiler" };
    }
    pendingIncoming = null;
    clearSyncTimer();
    observedPreviewProfile = null;
    options.store.enterPreview(incoming, false);
    return { kind: "entered" };
  };

  const notifyOpenResult = (
    onEvent: (event: SharePreviewEvent) => void,
  ): void => {
    const result = openFromHash();
    if (result.kind === "invalid" || result.kind === "requires-spoiler")
      onEvent(result);
  };

  const start = (onEvent: (event: SharePreviewEvent) => void): (() => void) => {
    if (started) return () => {};
    started = true;
    let runtimeStarted = false;
    const setup = (): void => {
      if (!started || runtimeStarted) return;
      runtimeStarted = true;
      const onStoreChange = (state: SharePreviewStoreState): void => {
        if (!state.activeIsPreview || !state.previewProfile) {
          clearSyncTimer();
          observedPreviewProfile = null;
          return;
        }
        if (pendingIncoming !== null) {
          clearSyncTimer();
          return;
        }
        if (state.previewProfile === observedPreviewProfile) return;
        observedPreviewProfile = state.previewProfile;
        scheduleProfileSync(state.previewProfile);
      };
      const unsubscribeStore = options.store.subscribe(onStoreChange);
      const unsubscribeHash = options.location.onHashChange(() =>
        notifyOpenResult(onEvent),
      );
      stopRuntime = () => {
        unsubscribeStore();
        unsubscribeHash();
        clearSyncTimer();
        observedPreviewProfile = null;
        runtimeStarted = false;
        stopRuntime = null;
      };
      onStoreChange(options.store.getState());
      notifyOpenResult(onEvent);
    };

    if (options.ready) stopReady = options.ready(setup);
    else setup();

    return () => {
      if (!started) return;
      started = false;
      stopReady();
      stopReady = () => {};
      stopRuntime?.();
    };
  };

  return {
    start,
    openFromHash,
    confirmIncomingPreview: (revealFuture) => {
      if (!pendingIncoming) return false;
      const incoming = pendingIncoming;
      pendingIncoming = null;
      clearSyncTimer();
      observedPreviewProfile = null;
      options.store.enterPreview(incoming, revealFuture);
      return true;
    },
    cancelIncomingPreview: clearShareHash,
    setPreviewFutureSight: (value) =>
      options.store.setPreviewShowFutureSight(value),
    clearShareHash,
    leavePreview: () => {
      clearShareHash();
      options.store.exitPreview();
    },
    importPreview: (enableFutureSight) => {
      options.store.importPreview(enableFutureSight);
      clearShareHash();
    },
    copyCurrent: async () => {
      const url = `${options.location.shareBaseUrl()}#p=${encodeShareToken(
        profileToPayload(activeProfile(options.store.getState())),
      )}`;
      try {
        await options.clipboard.writeText(url);
        return { url, copied: true };
      } catch {
        return { url, copied: false };
      }
    },
    getImportInfo: () => {
      const state = options.store.getState();
      if (!state.activeIsPreview || !state.previewProfile) return null;
      return {
        hasFutureContent: profileHasFutureContent(state.previewProfile),
        localFutureSightEnabled: state.localShowFutureSight,
      };
    },
  };
}

export function createBrowserSharePreviewSession(
  store: SharePreviewStore,
  ready: (callback: () => void) => () => void,
): SharePreviewSession {
  return createSharePreviewSession({
    store,
    ready,
    location: {
      getHash: () => location.hash,
      replaceHash: (hash) => {
        history.replaceState(
          null,
          "",
          location.pathname + location.search + (hash ? `#${hash}` : ""),
        );
      },
      shareBaseUrl: () =>
        `${location.origin}${location.pathname}${location.search}`,
      onHashChange: (listener) => {
        window.addEventListener("hashchange", listener);
        return () => window.removeEventListener("hashchange", listener);
      },
    },
    clipboard: {
      writeText: async (url) => {
        if (!navigator.clipboard?.writeText)
          throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(url);
      },
    },
  });
}
