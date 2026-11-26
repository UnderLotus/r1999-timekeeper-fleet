import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { CharacterDef, PsychubeDef } from "../../src/types/catalog";
import { emptyProfile, type Profile } from "../../src/types/profile";
import { setCatalogForTesting } from "../../src/utils/catalog";
import { ADD_DEFAULT } from "../../src/utils/profile-sanitize";
import {
  decodeShareToken,
  encodeShareToken,
  SHARE_VERSION,
} from "../../src/utils/share-code";
import {
  CHAR_MISTLETOE,
  CHAR_SONETTO,
  CHAR_TWINS,
  fixtureCharacters,
  fixturePsychubes,
  PSY_ART,
  PSY_NECESSARY,
  PSY_SCIENCE,
  withTestCatalog,
} from "../helpers/catalog-fixtures";

function overwriteBits(
  token: string,
  start: number,
  width: number,
  value: number,
): string {
  const bytes = Uint8Array.from(Buffer.from(token, "base64url"));
  for (let offset = 0; offset < width; offset++) {
    const position = start + offset;
    const bit = (value >> (width - offset - 1)) & 1;
    const mask = 1 << (7 - (position & 7));
    if (bit) bytes[position >> 3] |= mask;
    else bytes[position >> 3] &= ~mask;
  }
  return Buffer.from(bytes).toString("base64url");
}

function sampleProfile(): Profile {
  const profile = emptyProfile();
  profile.characters[CHAR_MISTLETOE.id] = {
    insight: 2,
    level: 45,
    portray: 3,
    resonance: 7,
    activeVariant: CHAR_MISTLETOE.skins.at(-1)!.id,
  };
  profile.characters[CHAR_SONETTO.id] = { ...ADD_DEFAULT, activeVariant: null };
  profile.characters[CHAR_TWINS.id] = {
    insight: 3,
    level: 60,
    portray: 0,
    resonance: 10,
    activeVariant: null,
  };
  profile.psychubes[PSY_NECESSARY.id] = 2;
  profile.psychubes[PSY_ART.id] = 1;
  profile.psychubes[PSY_SCIENCE.id] = 1;
  profile.teams[0].name = "雨幕舞台";
  profile.teams[0].slots[0] = {
    characterId: CHAR_MISTLETOE.id,
    psychubeId: PSY_NECESSARY.id,
    psychubeId2: null,
  };
  profile.teams[0].slots[1] = {
    characterId: CHAR_SONETTO.id,
    psychubeId: null,
    psychubeId2: null,
  };
  profile.teams[1].slots[0] = {
    characterId: CHAR_TWINS.id,
    psychubeId: PSY_ART.id,
    psychubeId2: PSY_SCIENCE.id,
  };
  profile.teams[2].slots[3] = {
    characterId: CHAR_MISTLETOE.id,
    psychubeId: PSY_NECESSARY.id,
    psychubeId2: null,
  };
  return profile;
}

describe("share-code (ADR 0002)", () => {
  beforeEach(() => {
    setCatalogForTesting(fixtureCharacters, fixturePsychubes);
  });

  it("round-trips builds, skins, psychubes, team names, dual psychubes, and 4x4 slots canonically", () => {
    const source = sampleProfile();
    const token = encodeShareToken(source);
    assert.match(token, /^[A-Za-z0-9_-]+$/);

    const decoded = decodeShareToken(token);
    assert.ok(decoded);
    assert.equal(decoded.sourceVersion, SHARE_VERSION);
    assert.deepEqual(decoded.profile, source);
    assert.equal(encodeShareToken(decoded.profile), token);

    // Excludes local preferences / Future Sight
    assert.equal("preferences" in decoded, false);
    assert.equal("showFutureSight" in decoded, false);
    assert.equal("showFutureSight" in decoded.profile, false);
  });

  it("round-trips empty profiles, all build preset & escape encodings, and psychube amplifications 1-5", () => {
    assert.deepEqual(
      decodeShareToken(encodeShareToken(emptyProfile()))?.profile,
      emptyProfile(),
    );

    // Owned-only preset + non-default skin
    const ownedOnlyWithSkin = emptyProfile();
    ownedOnlyWithSkin.characters[CHAR_MISTLETOE.id] = {
      insight: 0,
      level: 1,
      portray: 0,
      resonance: 1,
      activeVariant: CHAR_MISTLETOE.skins.at(-1)!.id,
    };
    assert.deepEqual(
      decodeShareToken(encodeShareToken(ownedOnlyWithSkin))?.profile,
      ownedOnlyWithSkin,
    );

    // All 4 combinations of Insight 3 Level 60 preset flags (portray 0 vs >0, resonance 10 vs !=10)
    for (const [portray, resonance] of [
      [0, 10],
      [5, 10],
      [0, 15],
      [2, 7],
    ] as const) {
      const i3Max = emptyProfile();
      i3Max.characters[CHAR_MISTLETOE.id] = {
        insight: 3,
        level: 60,
        portray,
        resonance,
        activeVariant: null,
      };
      assert.deepEqual(
        decodeShareToken(encodeShareToken(i3Max))?.profile.characters[
          CHAR_MISTLETOE.id
        ],
        i3Max.characters[CHAR_MISTLETOE.id],
      );
    }

    // Psychube default (1) and escape (2..5) paths
    const everyAmplification = emptyProfile();
    fixturePsychubes.forEach((item, index) => {
      everyAmplification.psychubes[item.id] = index + 1;
    });
    assert.deepEqual(
      decodeShareToken(encodeShareToken(everyAmplification))?.profile.psychubes,
      everyAmplification.psychubes,
    );
  });

  it("rejects malformed tokens and unsupported future share versions", () => {
    const token = encodeShareToken(sampleProfile());
    for (const bad of [
      "",
      token.slice(0, -1),
      `${token}!`,
      `${token}A`,
      overwriteBits(token, 0, 4, SHARE_VERSION + 1),
    ]) {
      assert.equal(decodeShareToken(bad), null);
    }
  });

  it("decodes frozen historical public share fixtures for v3, v4, and v5", () => {
    const legacyV3 = decodeShareToken(
      "MBLuymCAQ-hk9ERFdFnD80tMl3YfQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    assert.equal(legacyV3?.sourceVersion, 3);
    assert.equal(legacyV3?.profile.characters[CHAR_MISTLETOE.id]?.level, 30);
    assert.equal(legacyV3?.profile.characters[CHAR_MISTLETOE.id]?.portray, 4);
    assert.equal(legacyV3?.profile.psychubes[PSY_NECESSARY.id], 3);
    assert.equal(legacyV3?.profile.teams[0].name, "舊資料");
    assert.equal(
      legacyV3?.profile.teams[0].slots[0].characterId,
      CHAR_MISTLETOE.id,
    );
    assert.equal(
      legacyV3?.profile.teams[0].slots[0].psychubeId,
      PSY_NECESSARY.id,
    );

    const fixedV4 = decodeShareToken(
      "QAy7usbwZd4AARiaAAQBh9CGIyMSEzpm6jluZXoiJ7lj7Au7D6AAAu8AAAAAAAAAAAAAAAAAAAAxNGIxiQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAu7D6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    assert.equal(fixedV4?.sourceVersion, 4);
    assert.equal(fixedV4?.profile.characters[CHAR_MISTLETOE.id]?.level, 45);
    assert.equal(
      fixedV4?.profile.characters[CHAR_MISTLETOE.id]?.activeVariant,
      CHAR_MISTLETOE.skins.at(-1)!.id,
    );
    assert.equal(fixedV4?.profile.teams[0].name, "雨幕舞台");
    assert.deepEqual(fixedV4?.profile.teams[1].slots[0], {
      characterId: CHAR_TWINS.id,
      psychubeId: PSY_ART.id,
      psychubeId2: PSY_SCIENCE.id,
    });

    const fixedV5 = decodeShareToken(
      "UAi7vrG8HABD6IZzVtvyx9lyXUpzxMQwAAAAAAAAAAAAAA",
    );
    assert.equal(fixedV5?.sourceVersion, 5);
    assert.deepEqual(fixedV5?.profile.characters[CHAR_MISTLETOE.id], {
      insight: 2,
      level: 45,
      portray: 3,
      resonance: 7,
      activeVariant: "300303",
    });
    assert.deepEqual(fixedV5?.profile.characters[CHAR_SONETTO.id], {
      insight: 0,
      level: 1,
      portray: 0,
      resonance: 1,
      activeVariant: null,
    });
    assert.equal(fixedV5?.profile.psychubes[PSY_NECESSARY.id], 2);
    assert.equal(fixedV5?.profile.teams[0].name, "歷史五版");
    assert.deepEqual(fixedV5?.profile.teams[0].slots[0], {
      characterId: CHAR_MISTLETOE.id,
      psychubeId: PSY_NECESSARY.id,
      psychubeId2: null,
    });
  });

  it("encodes complete opaque 8-digit Variant IDs, clears unowned decoded Variants, and rejects out-of-range Variant IDs", () => {
    const longCharacters: CharacterDef[] = [
      {
        ...CHAR_MISTLETOE,
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
        ...CHAR_MISTLETOE,
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

    let longToken = "";
    withTestCatalog(
      [...fixtureCharacters, ...longCharacters],
      fixturePsychubes,
      () => {
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
        longToken = encodeShareToken(longProfile);
        const decoded = decodeShareToken(longToken);
        assert.equal(decoded?.sourceVersion, 6);
        assert.equal(
          decoded?.profile.characters["3066"]?.activeVariant,
          "30660001",
        );
        assert.equal(
          decoded?.profile.characters["3088"]?.activeVariant,
          "30880001",
        );
      },
    );

    // ADR 0002: when a decoded Variant is no longer owned by its Character, clear only activeVariant
    const variantRemoved: CharacterDef[] = [
      {
        ...longCharacters[0],
        skins: longCharacters[0].skins.filter((skin) => skin.id !== "30660001"),
      },
      longCharacters[1],
    ];
    withTestCatalog(
      [...fixtureCharacters, ...variantRemoved],
      fixturePsychubes,
      () => {
        const decoded = decodeShareToken(longToken);
        assert.equal(decoded?.profile.characters["3066"]?.activeVariant, null);
        assert.equal(decoded?.profile.characters["3066"]?.level, 45);
        assert.equal(
          decoded?.profile.characters["3088"]?.activeVariant,
          "30880001",
        );
      },
    );

    // Out-of-range (>27-bit) Variant ID fails encoding instead of truncating
    const overflowCharacter: CharacterDef = {
      ...longCharacters[0],
      skins: [
        ...longCharacters[0].skins,
        { id: "134217728", type: "skin", released: false },
      ],
    };
    withTestCatalog([overflowCharacter], fixturePsychubes, () => {
      const overflowProfile = emptyProfile();
      overflowProfile.characters["3066"] = {
        ...ADD_DEFAULT,
        activeVariant: "134217728",
      };
      assert.throws(
        () => encodeShareToken(overflowProfile),
        (error: unknown) =>
          error instanceof RangeError && String(error).includes("134217728"),
      );
    });
  });

  it("preserves wire reference alignment across unknown catalog IDs and catalog reordering", () => {
    const profile = emptyProfile();
    for (const item of fixtureCharacters)
      profile.characters[item.id] = { ...ADD_DEFAULT, activeVariant: null };
    for (const item of fixturePsychubes.slice(0, 4))
      profile.psychubes[item.id] = 1;
    profile.teams[0].slots[0] = {
      characterId: CHAR_TWINS.id,
      psychubeId: PSY_ART.id,
      psychubeId2: PSY_SCIENCE.id,
    };
    const token = encodeShareToken(profile);

    // Removing an earlier catalog ID must not shift positional references for later IDs
    withTestCatalog(
      fixtureCharacters.filter((item) => item.id !== "3005"),
      fixturePsychubes.filter((item) => item.id !== "1001"),
      () => {
        const decoded = decodeShareToken(token)?.profile;
        assert.deepEqual(decoded?.teams[0].slots[0], {
          characterId: CHAR_TWINS.id,
          psychubeId: PSY_ART.id,
          psychubeId2: PSY_SCIENCE.id,
        });
        assert.equal(Object.keys(decoded?.characters ?? {}).length, 3);
        assert.equal(Object.keys(decoded?.psychubes ?? {}).length, 3);
      },
    );

    // Reordering catalog does not break existing tokens
    withTestCatalog(
      [...fixtureCharacters].reverse(),
      [...fixturePsychubes].reverse(),
      () => {
        const decoded = decodeShareToken(token);
        assert.equal(
          decoded?.profile.teams[0].slots[0].characterId,
          CHAR_TWINS.id,
        );
      },
    );
  });

  it("enforces 10-bit collection count boundaries (255, 256, 1023 valid; 1024 throws RangeError)", () => {
    const syntheticCharacters: CharacterDef[] = Array.from(
      { length: 1024 },
      (_, index) => {
        const id = String(4000 + index);
        return {
          ...CHAR_MISTLETOE,
          id,
          baseId: id,
          releaseOrder: index + 1,
          defaultVariant: `${id}01`,
          skins: [{ id: `${id}01`, type: "default", released: true }],
        };
      },
    );
    const syntheticPsychubes: PsychubeDef[] = Array.from(
      { length: 1024 },
      (_, index) => ({ ...PSY_NECESSARY, id: String(6000 + index) }),
    );
    const buildProfile = (charCount: number, psyCount: number): Profile => {
      const profile = emptyProfile();
      for (let i = 0; i < charCount; i++)
        profile.characters[String(4000 + i)] = {
          ...ADD_DEFAULT,
          activeVariant: null,
        };
      for (let i = 0; i < psyCount; i++)
        profile.psychubes[String(6000 + i)] = 1;
      return profile;
    };

    withTestCatalog(syntheticCharacters, syntheticPsychubes, () => {
      for (const count of [255, 256, 1023]) {
        const decoded = decodeShareToken(
          encodeShareToken(buildProfile(count, count)),
        );
        assert.equal(Object.keys(decoded?.profile.characters ?? {}).length, count);
        assert.equal(Object.keys(decoded?.profile.psychubes ?? {}).length, count);
      }
      assert.throws(() => encodeShareToken(buildProfile(1024, 0)), RangeError);
      assert.throws(() => encodeShareToken(buildProfile(0, 1024)), RangeError);
    });
  });
});
