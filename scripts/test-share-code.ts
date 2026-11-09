import {
  decodeShareToken,
  encodeShareToken,
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
  return decodeShareToken(encodeShareToken(profile))
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
  p.characters[twins.id] = {
    insight: 3,
    level: 60,
    portray: 0,
    resonance: 10,
    activeVariant: null,
  };
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
  token = encodeShareToken(source),
  decoded = decodeShareToken(token),
  result = decoded ? decoded.profile : null;
check("round trip decodes", !!result);
check("version is explicit", decoded?.sourceVersion === SHARE_VERSION);
check(
  "character build round trips",
  result?.characters[a.id]?.level === 45 &&
    result.characters[a.id].portray === 3 &&
    result.characters[a.id].resonance === 7 &&
    result.characters[twins.id]?.insight === 3 &&
    result.characters[twins.id].level === 60 &&
    result.characters[twins.id].portray === 0 &&
    result.characters[twins.id].resonance === 10,
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
const malformedTokens: Array<[string, string]> = [
  ["truncated token", token.slice(0, -1)],
  ["invalid alphabet", token + "!"],
  ["appended canonical-looking data", token + "A"],
];
check(
  "malformed tokens are rejected",
  malformedTokens.every(([, candidate]) => decodeShareToken(candidate) === null),
);
const reencoded = result ? encodeShareToken(result) : "";
check("canonical re-encode stable", reencoded === token);
const legacyV3Token =
  "MBLuymCAQ-hk9ERFdFnD80tMl3YfQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const legacyV3 = decodeShareToken(legacyV3Token);
check(
  "legacy v3 tokens retain selected characters, builds, psychubes, and teams",
  legacyV3?.sourceVersion === 3 &&
    legacyV3.profile.characters[a.id]?.level === 30 &&
    legacyV3.profile.characters[a.id]?.portray === 4 &&
    legacyV3.profile.psychubes[psy.id] === 3 &&
    legacyV3.profile.teams[0].name === "舊資料" &&
    legacyV3.profile.teams[0].slots[0].characterId === a.id &&
    legacyV3.profile.teams[0].slots[0].psychubeId === psy.id,
);
const fixedV4Token =
  "QAy7usbwZd4AARiaAAQBh9CGIyMSEzpm6jluZXoiJ7lj7Au7D6AAAu8AAAAAAAAAAAAAAAAAAAAxNGIxiQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAu7D6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const fixedV4 = decodeShareToken(fixedV4Token);
check(
  "fixed public v4 fixture retains builds, skin, dual psychubes, and teams",
  fixedV4?.sourceVersion === 4 &&
    fixedV4.profile.characters[a.id]?.level === 45 &&
    fixedV4.profile.characters[a.id]?.activeVariant === a.skins.at(-1)!.id &&
    fixedV4.profile.teams[0].name === "雨幕舞台" &&
    fixedV4.profile.teams[1].slots[0].characterId === twins.id &&
    fixedV4.profile.teams[1].slots[0].psychubeId === twinsPsy1.id &&
    fixedV4.profile.teams[1].slots[0].psychubeId2 === twinsPsy2.id,
);
const fixedV5Token =
  "UAi7vrG8HABD6IZzVtvyx9lyXUpzxMQwAAAAAAAAAAAAAA";
const fixedV5 = decodeShareToken(fixedV5Token);
check(
  "fixed historical v5 token decodes its complete profile unchanged",
  fixedV5?.sourceVersion === 5 &&
    fixedV5.profile.characters[a.id]?.insight === 2 &&
    fixedV5.profile.characters[a.id]?.level === 45 &&
    fixedV5.profile.characters[a.id]?.portray === 3 &&
    fixedV5.profile.characters[a.id]?.resonance === 7 &&
    fixedV5.profile.characters[a.id]?.activeVariant === "300303" &&
    fixedV5.profile.characters[b.id]?.insight === 0 &&
    fixedV5.profile.characters[b.id]?.level === 1 &&
    fixedV5.profile.characters[b.id]?.activeVariant === null &&
    fixedV5.profile.psychubes[psy.id] === 2 &&
    fixedV5.profile.teams[0].name === "歷史五版" &&
    fixedV5.profile.teams[0].slots[0].characterId === a.id &&
    fixedV5.profile.teams[0].slots[0].psychubeId === psy.id &&
    fixedV5.profile.teams[0].slots[0].psychubeId2 === null,
);

const longCharacters: CharacterDef[] = [
  {
    ...a,
    id: "3066",
    baseId: "3066",
    defaultVariant: "306601",
    skins: [
      { id: "306601", type: "default", released: true },
      { id: "306602", type: "insight", released: true },
      { id: "30660001", type: "skin", released: false },
    ],
  },
  {
    ...a,
    id: "3088",
    baseId: "3088",
    defaultVariant: "308801",
    skins: [
      { id: "308801", type: "default", released: true },
      { id: "308802", type: "insight", released: true },
      { id: "30880001", type: "skin", released: false },
    ],
  },
];
setCatalogForTesting([...fixtureCharacters, ...longCharacters], fixturePsychubes);
const longProfile = emptyProfile();
longProfile.characters["3066"] = {
  insight: 2,
  level: 45,
  portray: 1,
  resonance: 7,
  activeVariant: "30660001",
};
longProfile.characters["3088"] = {
  insight: 2,
  level: 45,
  portray: 1,
  resonance: 7,
  activeVariant: "30880001",
};
const longDecoded = decodeShareToken(encodeShareToken(longProfile));
check(
  "v6 round trips complete eight-digit Variant IDs for both owners",
  longDecoded?.sourceVersion === 6 &&
    longDecoded.profile.characters["3066"]?.activeVariant === "30660001" &&
    longDecoded.profile.characters["3088"]?.activeVariant === "30880001",
);
const wireOverflowCharacter: CharacterDef = {
  ...longCharacters[0],
  skins: [
    ...longCharacters[0].skins,
    { id: "134217728", type: "skin", released: false },
  ],
};
setCatalogForTesting([wireOverflowCharacter], fixturePsychubes);
const wireOverflowProfile = emptyProfile();
wireOverflowProfile.characters[wireOverflowCharacter.id] = {
  ...longProfile.characters["3066"],
  activeVariant: "134217728",
};
let wireOverflowThrows = false;
try {
  encodeShareToken(wireOverflowProfile);
} catch (error) {
  wireOverflowThrows = error instanceof RangeError &&
    String(error).includes("134217728");
}
check("owned Variant IDs outside the v6 wire range fail clearly", wireOverflowThrows);
setCatalogForTesting(fixtureCharacters, fixturePsychubes);
check(
  "empty v6 round trips with zero-width local references",
  !!roundTrip(emptyProfile()),
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
const literalPresetToken = encodeShareToken(ownedOnlyWithSkin);
const originalAddDefault = { ...ADD_DEFAULT };
let literalPresetResult: ReturnType<typeof decodeShareToken> = null;
try {
  Object.assign(ADD_DEFAULT, {
    insight: 2,
    level: 30,
    portray: 5,
    resonance: 15,
  });
  literalPresetResult = decodeShareToken(literalPresetToken);
} finally {
  Object.assign(ADD_DEFAULT, originalAddDefault);
}
check(
  "v6 preset semantics do not depend on mutable add defaults",
  literalPresetResult?.profile.characters[a.id]?.insight === 0 &&
    literalPresetResult.profile.characters[a.id].level === 1 &&
    literalPresetResult.profile.characters[a.id].portray === 0 &&
    literalPresetResult.profile.characters[a.id].resonance === 1,
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
const decodedShape = decoded as unknown as
  | (Record<string, unknown> & { profile: Record<string, unknown> })
  | null;
check(
  "decoded share token excludes local preferences",
  !!decodedShape &&
    !("preferences" in decodedShape) &&
    !("showFutureSight" in decodedShape) &&
    !("showFutureSight" in decodedShape.profile),
);
check(
  "unsupported future share versions are rejected",
  decodeShareToken(overwriteBits(token, 0, 4, 7)) === null,
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
const positionalToken = encodeShareToken(positionalProfile);
setCatalogForTesting(
  fixtureCharacters.filter((item) => item.id !== "3005"),
  fixturePsychubes.filter((item) => item.id !== "1001"),
);
const positionalResult = decodeShareToken(positionalToken)?.profile;
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
const clean = decodeShareToken(encodeShareToken(stale))!.profile;
check("stale variant sanitizes", clean.characters[a.id].activeVariant === null);
setCatalogForTesting(
  [...fixtureCharacters].reverse(),
  [...fixturePsychubes].reverse(),
);
const afterCatalogReorder = decodeShareToken(token);
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
  const decodedBoundary = decodeShareToken(
    encodeShareToken(syntheticProfile(count, count)),
  );
  check(
    `10-bit collection counts round trip ${count} entries`,
    Object.keys(decodedBoundary?.profile.characters ?? {}).length === count &&
      Object.keys(decodedBoundary?.profile.psychubes ?? {}).length === count,
  );
}
const decodedMaximum = decodeShareToken(
  encodeShareToken(syntheticProfile(1023, 1023)),
);
check(
  "10-bit collection counts represent the explicit 1023-entry maximum",
  Object.keys(decodedMaximum?.profile.characters ?? {}).length === 1023 &&
    Object.keys(decodedMaximum?.profile.psychubes ?? {}).length === 1023,
);
function encodingThrows(profile: ReturnType<typeof emptyProfile>): boolean {
  try {
    encodeShareToken(profile);
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

console.log(`\nshare tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
