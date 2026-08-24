import {
  decodeSharePayload,
  encodeShareToken,
  payloadToProfile,
  profileToPayload,
  SHARE_VERSION,
} from "../src/utils/share-code";
import { ADD_DEFAULT } from "../src/store/boxStore";
import type { CharacterDef, PsychubeDef } from "../src/types/catalog";
import { emptyProfile } from "../src/types/profile";
import { setCatalogForTesting } from "../src/utils/catalog";
import { fixtureCharacters, fixturePsychubes } from "./test-fixtures";
setCatalogForTesting(fixtureCharacters, fixturePsychubes);
let pass = 0,
  fail = 0;
function check(name: string, value: boolean, detail = ""): void {
  if (value) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.error("  ✗ " + name + (detail ? " — " + detail : ""));
  }
}
const a = fixtureCharacters[0],
  b = fixtureCharacters[1],
  twins = fixtureCharacters.find((item) => item.id === "3149")!,
  psy = fixturePsychubes[0],
  twinsPsy1 = fixturePsychubes.find((item) => item.id === "1571")!,
  twinsPsy2 = fixturePsychubes.find((item) => item.id === "1572")!;
function sample() {
  const p = emptyProfile();
  p.characters[a.id] = {
    insight: 2,
    level: 45,
    portray: 3,
    resonance: 7,
    activeVariant: a.skins.at(-1)!.id,
  };
  p.characters[b.id] = { ...ADD_DEFAULT, activeVariant: null };
  p.characters[twins.id] = { ...ADD_DEFAULT, activeVariant: null };
  p.psychubes[psy.id] = 2;
  p.psychubes[twinsPsy1.id] = 1;
  p.psychubes[twinsPsy2.id] = 1;
  p.teams[0].name = "雨幕舞台";
  p.teams[0].slots[0] = {
    characterId: a.id,
    psychubeId: psy.id,
    psychubeId2: null,
  };
  p.teams[0].slots[1] = {
    characterId: b.id,
    psychubeId: null,
    psychubeId2: null,
  };
  p.teams[1].slots[0] = {
    characterId: twins.id,
    psychubeId: twinsPsy1.id,
    psychubeId2: twinsPsy2.id,
  };
  p.teams[2].slots[3] = {
    characterId: a.id,
    psychubeId: psy.id,
    psychubeId2: null,
  };
  return p;
}
const source = sample(),
  token = encodeShareToken(profileToPayload(source)),
  decoded = decodeSharePayload(token),
  result = decoded ? payloadToProfile(decoded) : null;
check("round trip decodes", !!result);
check("version is explicit", decoded?.version === SHARE_VERSION);
check(
  "character build round trips",
  result?.characters[a.id]?.level === 45 &&
    result.characters[a.id].portray === 3 &&
    result.characters[a.id].resonance === 7,
);
check(
  "skin variant round trips",
  result?.characters[a.id]?.activeVariant === a.skins.at(-1)!.id,
);
check("psychube imprint round trips", result?.psychubes[psy.id] === 2);
check("team name round trips", result?.teams[0].name === "雨幕舞台");
check(
  "dual psychubes round trip",
  result?.teams[1].slots[0].psychubeId === twinsPsy1.id &&
    result.teams[1].slots[0].psychubeId2 === twinsPsy2.id,
);
check(
  "4x4 order round trips",
  result?.teams.length === 4 && result.teams[2].slots[3].characterId === a.id,
);
check("token is base64url", /^[A-Za-z0-9_-]+$/.test(token));
const verboseToken = encodeURIComponent(
  JSON.stringify(profileToPayload(source)),
);
check(
  "binary codec is smaller than the equivalent URL-encoded JSON payload",
  token.length < verboseToken.length,
  `binary=${token.length}, json=${verboseToken.length}`,
);
check(
  "truncated token rejected",
  decodeSharePayload(token.slice(0, -1)) === null,
);
check("invalid alphabet rejected", decodeSharePayload(token + "!") === null);
check(
  "appended canonical-looking data rejected",
  decodeSharePayload(token + "A") === null,
);
const wrong = (token[0] === "A" ? "B" : "A") + token.slice(1);
check(
  "wrong version/corrupt header rejected",
  decodeSharePayload(wrong) === null,
);
const reencoded = result ? encodeShareToken(profileToPayload(result)) : "";
check("canonical re-encode stable", reencoded === token);
const legacyV3Token =
  "MBLuymCAQ-hk9ERFdFnD80tMl3YfQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const legacyV3 = decodeSharePayload(legacyV3Token);
check(
  "legacy v3 tokens retain selected characters, builds, psychubes, and teams",
  legacyV3?.version === 3 &&
    legacyV3.profile.characters[a.id]?.level === 30 &&
    legacyV3.profile.characters[a.id]?.portray === 4 &&
    legacyV3.profile.psychubes[psy.id] === 3 &&
    legacyV3.profile.teams[0].name === "舊資料" &&
    legacyV3.profile.teams[0].slots[0].characterId === a.id &&
    legacyV3.profile.teams[0].slots[0].psychubeId === psy.id,
);
const tokenForLocalPreference = (showFutureSight: boolean): string => {
  const localState = {
    profile: sample(),
    preferences: { showFutureSight },
  };
  return encodeShareToken(profileToPayload(localState.profile));
};
check(
  "local Future Sight preference does not affect the share token",
  tokenForLocalPreference(false) === tokenForLocalPreference(true),
);
const decodedShape = decoded as unknown as
  | (Record<string, unknown> & { profile: Record<string, unknown> })
  | null;
check(
  "decoded share payload excludes local preferences",
  !!decodedShape &&
    !("preferences" in decodedShape) &&
    !("showFutureSight" in decodedShape) &&
    !("showFutureSight" in decodedShape.profile),
);
const stale = sample();
stale.characters[a.id].activeVariant = "999999";
const clean = payloadToProfile(
  decodeSharePayload(encodeShareToken(profileToPayload(stale)))!,
);
check("stale variant sanitizes", clean.characters[a.id].activeVariant === null);
setCatalogForTesting(
  [...fixtureCharacters].reverse(),
  [...fixturePsychubes].reverse(),
);
const afterCatalogReorder = decodeSharePayload(token);
check(
  "catalog reordering does not break old token",
  afterCatalogReorder?.profile.teams[2].slots[3].characterId === a.id,
);
setCatalogForTesting(fixtureCharacters, fixturePsychubes);

function syntheticCharacter(index: number): CharacterDef {
  const id = String(4000 + index);
  return {
    ...a,
    id,
    baseId: id,
    releaseOrder: index + 1,
    defaultVariant: `${id}01`,
    skins: [{ id: `${id}01`, type: "default", released: true }],
  };
}
function syntheticPsychube(index: number): PsychubeDef {
  return { ...psy, id: String(6000 + index) };
}
function syntheticProfile(characterCount: number, psychubeCount: number) {
  const profile = emptyProfile();
  for (let index = 0; index < characterCount; index++)
    profile.characters[String(4000 + index)] = {
      ...ADD_DEFAULT,
      activeVariant: null,
    };
  for (let index = 0; index < psychubeCount; index++)
    profile.psychubes[String(6000 + index)] = 1;
  return profile;
}
const syntheticCharacters = Array.from({ length: 1024 }, (_, index) =>
  syntheticCharacter(index),
);
const syntheticPsychubes = Array.from({ length: 1024 }, (_, index) =>
  syntheticPsychube(index),
);
setCatalogForTesting(syntheticCharacters, syntheticPsychubes);
for (const count of [255, 256]) {
  const decodedBoundary = decodeSharePayload(
    encodeShareToken(profileToPayload(syntheticProfile(count, count))),
  );
  check(
    `10-bit collection counts round trip ${count} entries`,
    Object.keys(decodedBoundary?.profile.characters ?? {}).length === count &&
      Object.keys(decodedBoundary?.profile.psychubes ?? {}).length === count,
  );
}
const decodedMaximum = decodeSharePayload(
  encodeShareToken(profileToPayload(syntheticProfile(1023, 1023))),
);
check(
  "10-bit collection counts represent the explicit 1023-entry maximum",
  Object.keys(decodedMaximum?.profile.characters ?? {}).length === 1023 &&
    Object.keys(decodedMaximum?.profile.psychubes ?? {}).length === 1023,
);
function encodingThrows(profile: ReturnType<typeof emptyProfile>): boolean {
  try {
    encodeShareToken(profileToPayload(profile));
    return false;
  } catch (error) {
    return error instanceof RangeError;
  }
}
check(
  "1024 valid characters fail instead of wrapping or truncating",
  encodingThrows(syntheticProfile(1024, 0)),
);
check(
  "1024 valid psychubes fail instead of wrapping or truncating",
  encodingThrows(syntheticProfile(0, 1024)),
);
setCatalogForTesting(fixtureCharacters, fixturePsychubes);

console.log(`\nshare tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
