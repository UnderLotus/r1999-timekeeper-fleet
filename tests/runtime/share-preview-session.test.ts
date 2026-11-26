import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { emptyProfile, type Profile } from "../../src/types/profile";
import { setCatalogForTesting } from "../../src/utils/catalog";
import {
  decodeShareToken,
  encodeShareToken,
} from "../../src/utils/share-code";
import {
  createSharePreviewSession,
  type SharePreviewClipboard,
  type SharePreviewClock,
  type SharePreviewLocation,
  type SharePreviewSession,
  type SharePreviewStore,
  type SharePreviewStoreState,
} from "../../src/utils/share-preview-session";
import {
  CHAR_FUTURE,
  CHAR_MISTLETOE,
  CHAR_SONETTO,
  fixtureCharacters,
  fixturePsychubes,
} from "../helpers/catalog-fixtures";

interface Harness {
  session: SharePreviewSession;
  store: SharePreviewStore;
  state: () => SharePreviewStoreState;
  hash: () => string;
  setHash: (value: string) => void;
  flushTimers: () => void;
  copiedUrl: () => string | null;
}

function profileWithCharacter(id: string): Profile {
  const profile = emptyProfile();
  profile.characters[id] = {
    insight: 1,
    level: 40,
    portray: 2,
    resonance: 5,
    activeVariant: null,
  };
  return profile;
}

function createHarness(failCopy = false): Harness {
  let state: SharePreviewStoreState = {
    profile: emptyProfile(),
    previewProfile: null,
    previewShowFutureSight: false,
    localShowFutureSight: false,
  };
  const stateListeners = new Set<(next: SharePreviewStoreState) => void>();
  const publish = (next: SharePreviewStoreState): void => {
    state = next;
    for (const listener of stateListeners) listener(state);
  };
  const store: SharePreviewStore = {
    getState: () => state,
    subscribe: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    enterPreview: (profile, showFutureSight) =>
      publish({
        ...state,
        previewProfile: profile,
        previewShowFutureSight: showFutureSight,
      }),
    setPreviewShowFutureSight: (value) =>
      publish({ ...state, previewShowFutureSight: value }),
    exitPreview: () =>
      publish({
        ...state,
        previewProfile: null,
        previewShowFutureSight: false,
      }),
    importPreview: (enableFutureSight) => {
      if (!state.previewProfile) return;
      publish({
        ...state,
        profile: state.previewProfile,
        previewProfile: null,
        previewShowFutureSight: false,
        localShowFutureSight: enableFutureSight
          ? true
          : state.localShowFutureSight,
      });
    },
  };

  let hash = "";
  const hashListeners = new Set<() => void>();
  const setHash = (value: string): void => {
    hash = value.replace(/^#/, "");
    for (const listener of hashListeners) listener();
  };
  const location: SharePreviewLocation = {
    getHash: () => hash,
    replaceHash: (value) => {
      hash = value.replace(/^#/, "");
    },
    shareBaseUrl: () => "https://example.test/r1999-timekeeper-fleet/?x=1",
    onHashChange: (listener) => {
      hashListeners.add(listener);
      return () => hashListeners.delete(listener);
    },
  };

  let timerId = 0;
  const timers = new Map<number, () => void>();
  const clock: SharePreviewClock = {
    setTimeout: (callback) => {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
  };

  let copiedUrl: string | null = null;
  const clipboard: SharePreviewClipboard = {
    writeText: async (url) => {
      copiedUrl = url;
      if (failCopy) throw new Error("clipboard unavailable");
    },
  };

  const session = createSharePreviewSession({
    store,
    location,
    clipboard,
    clock,
    ready: (callback) => {
      callback();
      return () => {};
    },
  });

  return {
    session,
    store,
    state: () => state,
    hash: () => hash,
    setHash,
    flushTimers: () => {
      while (timers.size) {
        const [id, callback] = timers.entries().next().value as [
          number,
          () => void,
        ];
        timers.delete(id);
        callback();
      }
    },
    copiedUrl: () => copiedUrl,
  };
}

describe("share preview session (ADR 0003)", () => {
  beforeEach(() => {
    setCatalogForTesting(fixtureCharacters, fixturePsychubes);
  });

  it("opens a valid share into isolated Preview without mutating Local, and handles live hashchange", () => {
    const harness = createHarness();
    harness.store.getState().profile.characters[CHAR_MISTLETOE.id] = {
      insight: 0,
      level: 30,
      portray: 0,
      resonance: 0,
      activeVariant: null,
    };
    const localBefore = structuredClone(harness.state().profile);

    harness.setHash(`p=${encodeShareToken(profileWithCharacter(CHAR_SONETTO.id))}`);
    const events: string[] = [];
    harness.session.start((event) => events.push(event.kind));

    assert.deepEqual(events, []);
    assert.deepEqual(harness.state().profile, localBefore);
    assert.ok(harness.state().previewProfile?.characters[CHAR_SONETTO.id]);

    // Opening a historical v3 link via live hashchange enters Preview as well
    const legacyV3Token =
      "MBLuymCAQ-hk9ERFdFnD80tMl3YfQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    harness.setHash(`p=${legacyV3Token}`);
    assert.equal(
      harness.state().previewProfile?.characters[CHAR_MISTLETOE.id]?.level,
      30,
    );
  });

  it("gates Future-content shares behind spoiler confirmation and allows confirming or canceling", () => {
    const harness = createHarness();
    harness.setHash(`p=${encodeShareToken(profileWithCharacter(CHAR_FUTURE.id))}`);
    const events: string[] = [];
    harness.session.start((event) => events.push(event.kind));

    assert.deepEqual(events, ["requires-spoiler"]);
    assert.equal(harness.state().previewProfile, null);

    assert.equal(harness.session.confirmIncomingPreview(true), true);
    assert.ok(harness.state().previewProfile?.characters[CHAR_FUTURE.id]);
    assert.equal(harness.state().previewShowFutureSight, true);
    assert.deepEqual(harness.session.getImportInfo(), {
      hasFutureContent: true,
      localFutureSightEnabled: false,
    });

    // Canceling clears only the share parameter and stays Local
    const canceled = createHarness();
    canceled.setHash(
      `keep=1&p=${encodeShareToken(profileWithCharacter(CHAR_FUTURE.id))}`,
    );
    canceled.session.start(() => {});
    canceled.session.cancelIncomingPreview();
    assert.equal(canceled.hash(), "keep=1");
    assert.equal(canceled.state().previewProfile, null);
  });

  it("rejects invalid share tokens while preserving unrelated hash parameters", () => {
    const harness = createHarness();
    harness.setHash("keep=1&p=not-a-share-token");
    const events: string[] = [];
    harness.session.start((event) => events.push(event.kind));

    assert.deepEqual(events, ["invalid"]);
    assert.equal(harness.hash(), "keep=1");
  });

  it("syncs Preview edits back to the URL hash via debounce and shares the active Preview profile", async () => {
    const harness = createHarness();
    harness.store.getState().profile.characters[CHAR_MISTLETOE.id] = {
      insight: 0,
      level: 10,
      portray: 0,
      resonance: 1,
      activeVariant: null,
    };
    harness.session.start(() => {});
    harness.store.enterPreview(profileWithCharacter(CHAR_SONETTO.id), false);
    harness.flushTimers();

    const syncedToken = new URLSearchParams(harness.hash()).get("p");
    assert.ok(syncedToken);
    assert.equal(
      decodeShareToken(syncedToken)?.profile.characters[CHAR_SONETTO.id]?.level,
      40,
    );

    // ADR 0003: copyCurrent shares the active Preview, not the Local profile
    const copied = await harness.session.copyCurrent();
    assert.equal(copied.copied, true);
    assert.equal(copied.url, harness.copiedUrl());
    const copiedToken = new URL(copied.url).hash.replace(/^#p=/, "");
    assert.ok(
      decodeShareToken(copiedToken)?.profile.characters[CHAR_SONETTO.id],
    );
    assert.equal(
      decodeShareToken(copiedToken)?.profile.characters[CHAR_MISTLETOE.id],
      undefined,
    );

    // Clipboard failure returns a fallback URL
    const fallback = createHarness(true);
    const fallbackResult = await fallback.session.copyCurrent();
    assert.equal(fallbackResult.copied, false);
    assert.ok(fallbackResult.url.includes("#p="));
  });

  it("clears hash and discards Preview on leavePreview, and preserves receiver Future Sight choice on importPreview", () => {
    const leaving = createHarness();
    leaving.store.enterPreview(profileWithCharacter(CHAR_MISTLETOE.id), false);
    leaving.session.start(() => {});
    leaving.flushTimers();
    leaving.session.leavePreview();
    leaving.flushTimers();

    assert.equal(leaving.state().previewProfile, null);
    assert.equal(new URLSearchParams(leaving.hash()).has("p"), false);

    const importing = createHarness();
    importing.store.enterPreview(profileWithCharacter(CHAR_FUTURE.id), true);
    importing.session.importPreview(false);
    assert.equal(importing.state().previewProfile, null);
    assert.ok(importing.state().profile.characters[CHAR_FUTURE.id]);
    assert.equal(importing.state().localShowFutureSight, false);
    assert.equal(new URLSearchParams(importing.hash()).has("p"), false);
  });
});
