import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { emptyProfile } from "../../src/types/profile";
import {
  characterName,
  profileHasFutureContent,
  psychubeName,
  psychubesByRarityAndRecency,
  resolveEffectiveVariant,
  resolveVariant,
  setCatalogForTesting,
} from "../../src/utils/catalog";
import {
  presentCharacter,
  presentPsychube,
  presentTeamSlot,
} from "../../src/utils/presentation";
import { ADD_DEFAULT } from "../../src/utils/profile-sanitize";
import {
  CHAR_FUTURE,
  CHAR_MISTLETOE,
  fixtureCharacters,
  fixturePsychubes,
  PSY_FUTURE,
  PSY_NECESSARY,
} from "../helpers/catalog-fixtures";

describe("catalog & presentation", () => {
  beforeEach(() => {
    setCatalogForTesting(fixtureCharacters, fixturePsychubes);
  });

  it("falls back runtime names in order: requested -> en-US -> zh-CN -> id", () => {
    const partialCharacter = {
      ...CHAR_MISTLETOE,
      names: Object.freeze({
        "en-US": "English fallback",
        "zh-CN": "中文后备",
      }),
    };
    const chineseOnlyPsychube = {
      ...PSY_NECESSARY,
      names: Object.freeze({ "zh-CN": "中文心相" }),
    };
    const unrelatedLocalePsychube = {
      ...PSY_NECESSARY,
      names: Object.freeze({ "ja-JP": "日本語だけ" }),
    };

    assert.equal(characterName(partialCharacter, "ko-KR"), "English fallback");
    assert.equal(characterName(partialCharacter, "en"), "English fallback");
    assert.equal(psychubeName(chineseOnlyPsychube, "ko-KR"), "中文心相");
    assert.equal(psychubeName(unrelatedLocalePsychube, "ko-KR"), PSY_NECESSARY.id);
  });

  it("orders psychubes by higher rarity first and later catalog index first within each rarity", () => {
    const ids = psychubesByRarityAndRecency().map((item) => item.id);
    assert.deepEqual(ids, ["1002", "1000", "1572", "1571", "1001"]);
  });

  it("resolves effective variants without leaking unreleased skins when Future Sight is off", () => {
    const unreleasedSkin = CHAR_MISTLETOE.skins.find((skin) => !skin.released)!;

    assert.equal(resolveVariant(CHAR_MISTLETOE, "stale-id").id, "300301");
    assert.equal(
      resolveEffectiveVariant(CHAR_MISTLETOE, unreleasedSkin.id, false).id,
      CHAR_MISTLETOE.defaultVariant,
    );
    assert.equal(
      resolveEffectiveVariant(CHAR_MISTLETOE, unreleasedSkin.id, true).id,
      unreleasedSkin.id,
    );
  });

  it("detects future content from characters, skins, and psychubes", () => {
    assert.equal(profileHasFutureContent(emptyProfile()), false);

    const withFutureChar = emptyProfile();
    withFutureChar.characters[CHAR_FUTURE.id] = {
      ...ADD_DEFAULT,
      activeVariant: null,
    };
    assert.equal(profileHasFutureContent(withFutureChar), true);

    const withFutureSkin = emptyProfile();
    withFutureSkin.characters[CHAR_MISTLETOE.id] = {
      ...ADD_DEFAULT,
      activeVariant: "300303",
    };
    assert.equal(profileHasFutureContent(withFutureSkin), true);

    const withFuturePsy = emptyProfile();
    withFuturePsy.psychubes[PSY_FUTURE.id] = 1;
    assert.equal(profileHasFutureContent(withFuturePsy), true);
  });

  it("hides future character and psychube details in presentation while Future Sight is off", () => {
    const hiddenChar = presentCharacter(
      CHAR_FUTURE,
      { ...ADD_DEFAULT, activeVariant: null },
      "en-US",
      false,
      "Unreleased",
    );
    assert.equal(hiddenChar.hidden, true);
    assert.equal(hiddenChar.name, "Unreleased");

    const hiddenPsy = presentPsychube(PSY_FUTURE, "en-US", false, "Unreleased");
    assert.equal(hiddenPsy.hidden, true);
    assert.equal(hiddenPsy.name, "Unreleased");

    const profile = emptyProfile();
    profile.characters[CHAR_MISTLETOE.id] = {
      ...ADD_DEFAULT,
      activeVariant: "300303",
    };
    profile.psychubes[PSY_FUTURE.id] = 3;
    const slot = {
      characterId: CHAR_MISTLETOE.id,
      psychubeId: PSY_FUTURE.id,
      psychubeId2: null,
    };

    const hiddenSlot = presentTeamSlot(slot, profile, "en-US", false, "Hidden");
    assert.equal(hiddenSlot.character?.hidden, false);
    assert.equal(hiddenSlot.character?.variant.id, CHAR_MISTLETOE.defaultVariant);
    assert.equal(hiddenSlot.psychubes[0]?.hidden, true);
    assert.equal(hiddenSlot.psychubes[0]?.name, "Hidden");

    const revealedSlot = presentTeamSlot(slot, profile, "en-US", true, "Hidden");
    assert.equal(revealedSlot.character?.variant.id, "300303");
    assert.equal(revealedSlot.psychubes[0]?.hidden, false);
    assert.equal(revealedSlot.psychubes[0]?.name, "Future Psychube");
    assert.equal(revealedSlot.psychubes[0]?.amplification, 3);
  });
});
