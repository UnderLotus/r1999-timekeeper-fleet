import {
  decodeShareToken,
  encodeShareToken,
} from "../src/utils/share-code";
import { emptyProfile, type Profile } from "../src/types/profile";
import { setCatalogForTesting } from "../src/utils/catalog";
import {
  createSharePreviewSession,
  type SharePreviewClipboard,
  type SharePreviewClock,
  type SharePreviewLocation,
  type SharePreviewSession,
  type SharePreviewStore,
  type SharePreviewStoreState,
} from "../src/utils/share-preview-session";
import { fixtureCharacters, fixturePsychubes } from "./test-fixtures";

setCatalogForTesting(fixtureCharacters, fixturePsychubes);

let pass = 0;
let fail = 0;
function check(name: string, value: boolean): void {
  if (value) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

interface Harness {
  session: SharePreviewSession;
  store: SharePreviewStore;
  state: () => SharePreviewStoreState;
  hash: () => string;
  setHash: (value: string) => void;
  flushTimers: () => void;
  scheduledTimerCount: () => number;
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
  const stateListeners = new Set<
    (next: SharePreviewStoreState) => void
  >();
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
  let scheduledTimerCount = 0;
  const timers = new Map<number, () => void>();
  const clock: SharePreviewClock = {
    setTimeout: (callback) => {
      scheduledTimerCount++;
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
    scheduledTimerCount: () => scheduledTimerCount,
    copiedUrl: () => copiedUrl,
  };
}

const a = fixtureCharacters[0];
const b = fixtureCharacters[1];
const future = fixtureCharacters[2];
const tokenFor = (profile: Profile): string =>
  encodeShareToken(profile);

const valid = createHarness();
valid.store.getState().profile.characters[a.id] = {
  insight: 0,
  level: 30,
  portray: 0,
  resonance: 0,
  activeVariant: null,
};
const localBefore = JSON.stringify(valid.state().profile);
valid.setHash(`p=${tokenFor(profileWithCharacter(b.id))}`);
const validEvents: string[] = [];
valid.session.start((event) => validEvents.push(event.kind));
check(
  "valid v5 share enters isolated Preview without overwriting Local",
  valid.state().previewProfile !== null &&
    JSON.stringify(valid.state().profile) === localBefore &&
    !!valid.state().previewProfile?.characters[b.id] &&
    validEvents.length === 0,
);

const futurePreview = createHarness();
futurePreview.setHash(`p=${tokenFor(profileWithCharacter(future.id))}`);
const futureEvents: string[] = [];
futurePreview.session.start((event) => futureEvents.push(event.kind));
check(
  "Future-content share waits for spoiler confirmation",
  futureEvents.join(",") === "requires-spoiler" &&
    futurePreview.state().previewProfile === null,
);
check(
  "spoiler confirmation enters Preview with Future Sight enabled",
  futurePreview.session.confirmIncomingPreview(true) &&
    futurePreview.state().previewProfile !== null &&
    futurePreview.state().previewShowFutureSight,
);

const gatedAfterPreview = createHarness();
gatedAfterPreview.session.start(() => {});
const previousPreview = profileWithCharacter(a.id);
gatedAfterPreview.store.enterPreview(previousPreview, false);
const incomingFutureToken = tokenFor(profileWithCharacter(future.id));
gatedAfterPreview.setHash(`keep=1&p=${incomingFutureToken}`);
gatedAfterPreview.flushTimers();
check(
  "spoiler gate cancels an earlier Preview debounce before it can overwrite the incoming hash",
  gatedAfterPreview.hash() === `keep=1&p=${incomingFutureToken}` &&
    gatedAfterPreview.state().previewProfile !== null &&
    gatedAfterPreview.state().previewProfile === previousPreview,
);

const unrelatedStoreUpdate = createHarness();
unrelatedStoreUpdate.session.start(() => {});
unrelatedStoreUpdate.store.enterPreview(profileWithCharacter(a.id), false);
const schedulesAfterPreview = unrelatedStoreUpdate.scheduledTimerCount();
unrelatedStoreUpdate.store.setPreviewShowFutureSight(true);
unrelatedStoreUpdate.store.setPreviewShowFutureSight(false);
check(
  "unrelated Preview state updates do not restart hash synchronization debounce",
  unrelatedStoreUpdate.scheduledTimerCount() === schedulesAfterPreview,
);

const canceled = createHarness();
canceled.setHash(`keep=1&p=${tokenFor(profileWithCharacter(future.id))}`);
canceled.session.start(() => {});
canceled.session.cancelIncomingPreview();
check(
  "canceling the spoiler gate clears the incoming share and stays Local",
  canceled.hash() === "keep=1" && canceled.state().previewProfile === null,
);

const invalid = createHarness();
invalid.setHash("keep=1&p=not-a-share-token");
const invalidEvents: string[] = [];
invalid.session.start((event) => invalidEvents.push(event.kind));
check(
  "invalid share tokens are rejected and only the share parameter is cleared",
  invalidEvents.join(",") === "invalid" && invalid.hash() === "keep=1",
);

const synced = createHarness();
synced.session.start(() => {});
synced.store.enterPreview(profileWithCharacter(a.id), false);
synced.flushTimers();
const syncedToken = new URLSearchParams(synced.hash()).get("p");
check(
  "Preview changes update the share hash through the debounced session",
  !!syncedToken &&
    decodeShareToken(syncedToken)?.profile.characters[a.id]?.level === 40,
);
synced.store.enterPreview(profileWithCharacter(b.id), false);
synced.flushTimers();
check(
  "debounced hash synchronization follows the latest Preview profile",
  !!new URLSearchParams(synced.hash()).get("p") &&
    decodeShareToken(new URLSearchParams(synced.hash()).get("p")!)?.profile
      .characters[b.id] !== undefined,
);

const copied = createHarness();
const copiedResult = await copied.session.copyCurrent();
check(
  "copyCurrent generates the current profile URL through the session",
  copiedResult.copied && copiedResult.url === copied.copiedUrl() &&
    copiedResult.url.includes("#p="),
);
const copyFallback = createHarness(true);
const fallbackResult = await copyFallback.session.copyCurrent();
check(
  "copyCurrent returns a fallback URL when clipboard access fails",
  !fallbackResult.copied && fallbackResult.url.includes("#p="),
);

const leaving = createHarness();
leaving.store.enterPreview(profileWithCharacter(a.id), false);
leaving.session.start(() => {});
leaving.flushTimers();
leaving.session.leavePreview();
leaving.flushTimers();
check(
  "leave Preview clears the share hash, cancels sync, and discards Preview",
  leaving.state().previewProfile === null &&
    !new URLSearchParams(leaving.hash()).has("p"),
);

const importHidden = createHarness();
importHidden.store.enterPreview(profileWithCharacter(future.id), true);
importHidden.session.importPreview(false);
check(
  "Import keeps Future Sight disabled by default",
  importHidden.state().previewProfile === null &&
    !!importHidden.state().profile.characters[future.id] &&
    !importHidden.state().localShowFutureSight &&
    !new URLSearchParams(importHidden.hash()).has("p"),
);
const importEnabled = createHarness();
importEnabled.store.enterPreview(profileWithCharacter(future.id), true);
importEnabled.session.importPreview(true);
check(
  "Import can explicitly enable local Future Sight",
  !!importEnabled.state().profile.characters[future.id] &&
    importEnabled.state().localShowFutureSight,
);

const legacyV3Token =
  "MBLuymCAQ-hk9ERFdFnD80tMl3YfQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const fixedV4Token =
  "QAy7usbwZd4AARiaAAQBh9CGIyMSEzpm6jluZXoiJ7lj7Au7D6AAAu8AAAAAAAAAAAAAAAAAAAAxNGIxiQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAu7D6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const emptyV5Token = tokenFor(emptyProfile());
for (const [version, token] of [
  [3, legacyV3Token],
  [4, fixedV4Token],
  [5, emptyV5Token],
] as const) {
  const historical = createHarness();
  historical.setHash(`p=${token}`);
  const events: string[] = [];
  historical.session.start((event) => events.push(event.kind));
  if (events.includes("requires-spoiler"))
    historical.session.confirmIncomingPreview(true);
  check(
    `session opens supported v${version} share tokens`,
    decodeShareToken(token)?.sourceVersion === version &&
      historical.state().previewProfile !== null,
  );
}

console.log(`\nshare preview session tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
