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
function overwriteBits(
  token: string,
  start: number,
  width: number,
  value: number,
): string {
  const bytes = Uint8Array.from(Buffer.from(token, "base64url"));
  for (let offset = 0; offset < width; offset++) {
    const position = start + offset,
      bit = (value >> (width - offset - 1)) & 1,
      mask = 1 << (7 - (position & 7));
    if (bit) bytes[position >> 3] |= mask;
    else bytes[position >> 3] &= ~mask;
  }
  return Buffer.from(bytes).toString("base64url");
}
function roundTrip(profile: ReturnType<typeof emptyProfile>) {
  return decodeSharePayload(encodeShareToken(profileToPayload(profile)))
    ?.profile;
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
const fixedV4Token =
  "QAy7usbwZd4AARiaAAQBh9CGIyMSEzpm6jluZXoiJ7lj7Au7D6AAAu8AAAAAAAAAAAAAAAAAAAAxNGIxiQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAu7D6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const fixedV4 = decodeSharePayload(fixedV4Token);
check(
  "fixed public v4 fixture retains builds, skin, dual psychubes, and teams",
  fixedV4?.version === 4 &&
    fixedV4.profile.characters[a.id]?.level === 45 &&
    fixedV4.profile.characters[a.id]?.activeVariant === a.skins.at(-1)!.id &&
    fixedV4.profile.teams[0].name === "雨幕舞台" &&
    fixedV4.profile.teams[1].slots[0].characterId === twins.id &&
    fixedV4.profile.teams[1].slots[0].psychubeId === twinsPsy1.id &&
    fixedV4.profile.teams[1].slots[0].psychubeId2 === twinsPsy2.id,
);
check(
  "v5 materially shortens the representative v4 profile",
  token.length <= Math.floor(fixedV4Token.length * 0.65),
  `v4=${fixedV4Token.length}, v5=${token.length}`,
);

const emptyV5Token = encodeShareToken(profileToPayload(emptyProfile()));
check(
  "empty v5 round trips with zero-width local references",
  emptyV5Token.length === 8 && !!roundTrip(emptyProfile()),
  `length=${emptyV5Token.length}`,
);
const ownedOnlyWithSkin = emptyProfile();
ownedOnlyWithSkin.characters[a.id] = {
  ...ADD_DEFAULT,
  activeVariant: a.skins.at(-1)!.id,
};
const ownedOnlyResult = roundTrip(ownedOnlyWithSkin);
check(
  "owned-only preset remains independent from a non-default valid skin",
  ownedOnlyResult?.characters[a.id]?.insight === 0 &&
    ownedOnlyResult.characters[a.id].level === 1 &&
    ownedOnlyResult.characters[a.id].portray === 0 &&
    ownedOnlyResult.characters[a.id].resonance === 1 &&
    ownedOnlyResult.characters[a.id].activeVariant === a.skins.at(-1)!.id,
);
const literalPresetToken = encodeShareToken(
  profileToPayload(ownedOnlyWithSkin),
);
const originalAddDefault = { ...ADD_DEFAULT };
let literalPresetResult: ReturnType<typeof decodeSharePayload> = null;
try {
  Object.assign(ADD_DEFAULT, {
    insight: 2,
    level: 30,
    portray: 5,
    resonance: 15,
  });
  literalPresetResult = decodeSharePayload(literalPresetToken);
} finally {
  Object.assign(ADD_DEFAULT, originalAddDefault);
}
check(
  "v5 preset semantics do not depend on mutable add defaults",
  literalPresetResult?.profile.characters[a.id]?.insight === 0 &&
    literalPresetResult.profile.characters[a.id].level === 1 &&
    literalPresetResult.profile.characters[a.id].portray === 0 &&
    literalPresetResult.profile.characters[a.id].resonance === 1,
);
const insightThreePresets = emptyProfile();
insightThreePresets.characters[a.id] = {
  insight: 3,
  level: 60,
  portray: 0,
  resonance: 10,
  activeVariant: null,
};
insightThreePresets.characters[twins.id] = {
  insight: 3,
  level: 60,
  portray: 2,
  resonance: 15,
  activeVariant: null,
};
const insightThreeResult = roundTrip(insightThreePresets);
check(
  "I3/L60 preset preserves default and escaped portray/resonance values",
  insightThreeResult?.characters[a.id]?.portray === 0 &&
    insightThreeResult.characters[a.id].resonance === 10 &&
    insightThreeResult.characters[twins.id]?.portray === 2 &&
    insightThreeResult.characters[twins.id].resonance === 15,
);
const genericBuild = emptyProfile();
genericBuild.characters[a.id] = {
  insight: 2,
  level: 45,
  portray: 3,
  resonance: 7,
  activeVariant: null,
};
const genericBuildResult = roundTrip(genericBuild);
check(
  "generic build escape preserves non-preset cultivation",
  genericBuildResult?.characters[a.id]?.level === 45 &&
    genericBuildResult.characters[a.id].portray === 3 &&
    genericBuildResult.characters[a.id].resonance === 7,
);
const everyImprint = emptyProfile();
fixturePsychubes.forEach((item, index) => {
  everyImprint.psychubes[item.id] = index + 1;
});
const imprintResult = roundTrip(everyImprint);
check(
  "psychube default and escape paths preserve imprints 1 through 5",
  fixturePsychubes.every(
    (item, index) => imprintResult?.psychubes[item.id] === index + 1,
  ),
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
const twoCloseIds = emptyProfile();
twoCloseIds.characters[a.id] = { ...ADD_DEFAULT, activeVariant: null };
twoCloseIds.characters[b.id] = { ...ADD_DEFAULT, activeVariant: null };
const twoCloseIdsToken = encodeShareToken(profileToPayload(twoCloseIds));
// Header (4) + count (10) + first ID (14) + owned preset (1) + variant (1).
const secondDeltaOffset = 30;
check(
  "malformed zero/unbounded gamma delta is rejected",
  decodeSharePayload(
    overwriteBits(twoCloseIdsToken, secondDeltaOffset, 14, 0),
  ) === null,
);
check(
  "delta accumulation beyond the 14-bit official ID range is rejected",
  decodeSharePayload(overwriteBits(twoCloseIdsToken, 14, 14, 16383)) === null,
);
const boundaryCharacters: CharacterDef[] = [1, 16383].map((id, index) => ({
  ...a,
  id: String(id),
  baseId: String(id),
  releaseOrder: index + 1,
  defaultVariant: `${id}01`,
  skins: [{ id: `${id}01`, type: "default", released: true }],
}));
setCatalogForTesting(boundaryCharacters, fixturePsychubes);
const maximumDeltaProfile = emptyProfile();
for (const item of boundaryCharacters)
  maximumDeltaProfile.characters[item.id] = {
    ...ADD_DEFAULT,
    activeVariant: null,
  };
const maximumDeltaToken = encodeShareToken(
  profileToPayload(maximumDeltaProfile),
);
check(
  "maximum legal 14-bit ID and delta round trip",
  Object.keys(roundTrip(maximumDeltaProfile)?.characters ?? {}).length === 2,
);
check(
  "a token truncated in the middle of a gamma delta is rejected",
  decodeSharePayload(
    Buffer.from(maximumDeltaToken, "base64url")
      .subarray(0, 5)
      .toString("base64url"),
  ) === null,
);
setCatalogForTesting(fixtureCharacters, fixturePsychubes);
// Two characters require 2-bit references; 3 is outside the wire count.
check(
  "local references beyond the encoded collection count are rejected",
  decodeSharePayload(overwriteBits(twoCloseIdsToken, 49, 2, 3)) === null,
);
// A present skin suffix is constrained to the literal wire range 1..127.
check(
  "a present zero skin suffix is rejected",
  decodeSharePayload(overwriteBits(literalPresetToken, 30, 7, 0)) === null,
);
check(
  "unsupported future share versions are rejected",
  decodeSharePayload(overwriteBits(token, 0, 4, 6)) === null,
);
const variedDeltas = emptyProfile();
for (const item of fixtureCharacters)
  variedDeltas.characters[item.id] = { ...ADD_DEFAULT, activeVariant: null };
check(
  "sorted delta encoding handles repeated small deltas and larger jumps",
  Object.keys(roundTrip(variedDeltas)?.characters ?? {}).length ===
    fixtureCharacters.length,
);

const positionalProfile = emptyProfile();
for (const item of fixtureCharacters)
  positionalProfile.characters[item.id] = {
    ...ADD_DEFAULT,
    activeVariant: null,
  };
for (const item of fixturePsychubes.slice(0, 4))
  positionalProfile.psychubes[item.id] = 1;
positionalProfile.teams[0].slots[0] = {
  characterId: twins.id,
  psychubeId: twinsPsy1.id,
  psychubeId2: twinsPsy2.id,
};
const positionalToken = encodeShareToken(profileToPayload(positionalProfile));
setCatalogForTesting(
  fixtureCharacters.filter((item) => item.id !== "3005"),
  fixturePsychubes.filter((item) => item.id !== "1001"),
);
const positionalResult = decodeSharePayload(positionalToken)?.profile;
check(
  "unknown wire positions do not shift character or dual psychube references",
  positionalResult?.teams[0].slots[0].characterId === twins.id &&
    positionalResult.teams[0].slots[0].psychubeId === twinsPsy1.id &&
    positionalResult.teams[0].slots[0].psychubeId2 === twinsPsy2.id,
);
check(
  "local reference widths derive from wire counts before unknown IDs are removed",
  Object.keys(positionalResult?.characters ?? {}).length === 3 &&
    Object.keys(positionalResult?.psychubes ?? {}).length === 3,
);
setCatalogForTesting(fixtureCharacters, fixturePsychubes);

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
for (const count of [255, 256, 512]) {
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
