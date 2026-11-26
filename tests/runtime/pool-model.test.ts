import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  emptyProfile,
  type CharacterBuild,
  type Profile,
} from "../../src/types/profile";
import { setCatalogForTesting } from "../../src/utils/catalog";
import {
  createPoolUiState,
  createPoolView,
  normalizeRarityFilter,
  summarizePsychubeOwnership,
  transitionPoolAssignment,
  type PoolUiState,
} from "../../src/utils/pool-model";
import {
  CHAR_FUTURE,
  CHAR_MISTLETOE,
  CHAR_SONETTO,
  fixtureCharacters,
  fixturePsychubes,
  PSY_FUTURE,
  PSY_NECESSARY,
} from "../helpers/catalog-fixtures";

const baseBuild: CharacterBuild = {
  insight: 1,
  level: 40,
  portray: 2,
  resonance: 5,
  activeVariant: null,
};

function sampleProfile(): Profile {
  const profile = emptyProfile();
  profile.characters[CHAR_MISTLETOE.id] = { ...baseBuild };
  profile.characters[CHAR_FUTURE.id] = { ...baseBuild };
  profile.psychubes[PSY_NECESSARY.id] = 2;
  profile.psychubes[PSY_FUTURE.id] = 3;
  return profile;
}

describe("pool model", () => {
  beforeEach(() => {
    setCatalogForTesting(fixtureCharacters, fixturePsychubes);
  });

  it("filters characters by Future Sight, multi-locale search, ownership, and 0-based rarity", () => {
    const profile = sampleProfile();
    const releasedView = createPoolView({
      profile,
      tab: "characters",
      search: "",
      filterMode: "all",
      rarityFilter: [],
      revealFuture: false,
    });
    assert.equal(
      releasedView.characters.some(
        ({ definition }) => definition.id === CHAR_FUTURE.id,
      ),
      false,
    );
    assert.deepEqual(releasedView.rarityOptions, [2, 3, 4, 5, 6]);

    // Multi-locale case-insensitive trimmed search
    const futureByEnglish = createPoolView({
      profile,
      tab: "characters",
      search: "  future character ",
      filterMode: "all",
      rarityFilter: [],
      revealFuture: true,
    });
    assert.deepEqual(
      futureByEnglish.characters.map(({ definition }) => definition.id),
      [CHAR_FUTURE.id],
    );

    const byJapanese = createPoolView({
      profile,
      tab: "characters",
      search: "ソネット",
      filterMode: "all",
      rarityFilter: [],
      revealFuture: false,
    });
    assert.deepEqual(
      byJapanese.characters.map(({ definition }) => definition.id),
      [CHAR_SONETTO.id],
    );

    // Ownership filters
    const ownedView = createPoolView({
      profile,
      tab: "characters",
      search: "",
      filterMode: "owned",
      rarityFilter: [],
      revealFuture: true,
    });
    const unownedView = createPoolView({
      profile,
      tab: "characters",
      search: "",
      filterMode: "unowned",
      rarityFilter: [],
      revealFuture: true,
    });
    assert.deepEqual(
      ownedView.characters.map(({ definition }) => definition.id),
      [CHAR_MISTLETOE.id, CHAR_FUTURE.id],
    );
    assert.ok(unownedView.characters.every(({ owned }) => !owned));
    assert.ok(
      unownedView.characters.some(
        ({ definition }) => definition.id === CHAR_SONETTO.id,
      ),
    );

    // 6-star filter matches catalog rarity=5
    const sixStarView = createPoolView({
      profile,
      tab: "characters",
      search: "",
      filterMode: "all",
      rarityFilter: [6],
      revealFuture: false,
    });
    assert.deepEqual(
      sixStarView.characters.map(({ definition }) => definition.id),
      [CHAR_MISTLETOE.id],
    );
  });

  it("normalizes psychube rarity filters, excludes 2-star filter, and summarizes ownership states", () => {
    const profile = sampleProfile();
    assert.deepEqual(normalizeRarityFilter("psychubes", [2, 3, 6, 7]), [3, 6]);

    const psychubeView = createPoolView({
      profile,
      tab: "psychubes",
      search: "",
      filterMode: "all",
      rarityFilter: [2],
      revealFuture: false,
    });
    assert.deepEqual(psychubeView.visibleRarityFilter, []);
    assert.equal(psychubeView.psychubes.length, 4);
    assert.equal(
      psychubeView.psychubes.find(
        ({ definition }) => definition.id === PSY_NECESSARY.id,
      )?.amplification,
      2,
    );
    assert.deepEqual(psychubeView.psychubeOwnership, {
      visibleCount: 4,
      ownedCount: 1,
      status: null,
    });

    const fiveStarPsychubes = createPoolView({
      profile,
      tab: "psychubes",
      search: "",
      filterMode: "all",
      rarityFilter: [5],
      revealFuture: true,
    });
    assert.deepEqual(
      fiveStarPsychubes.psychubes.map(({ definition }) => definition.id),
      ["1572", "1571", "1001"],
    );

    assert.equal(
      summarizePsychubeOwnership(emptyProfile(), false).status,
      "unowned",
    );
    const complete = emptyProfile();
    for (const item of fixturePsychubes) complete.psychubes[item.id] = 1;
    assert.equal(summarizePsychubeOwnership(complete, true).status, "owned");
  });

  it("temporarily switches to owned filter during assignment and restores original filter afterwards", () => {
    let ui: PoolUiState = {
      ...createPoolUiState(),
      tab: "psychubes",
      search: "藝術",
      filterMode: "unowned",
      rarityFilter: [5, 6],
    };
    ui = transitionPoolAssignment(ui, { team: 1, slot: 2, kind: "character" });
    assert.equal(ui.tab, "characters");
    assert.equal(ui.filterMode, "owned");
    assert.equal(ui.assignmentPreviousFilter, "unowned");

    // Switching directly to another assignment must preserve the original "unowned" filter
    ui = transitionPoolAssignment(ui, { team: 1, slot: 2, kind: "psychube" });
    assert.equal(ui.tab, "psychubes");
    assert.equal(ui.filterMode, "owned");
    assert.equal(ui.assignmentPreviousFilter, "unowned");

    // User tweaks during assignment stay intact except filterMode restores
    ui = { ...ui, search: "temporary", filterMode: "all", rarityFilter: [3] };
    ui = transitionPoolAssignment(ui, null);
    assert.equal(ui.assignment, null);
    assert.equal(ui.assignmentPreviousFilter, null);
    assert.equal(ui.tab, "psychubes");
    assert.equal(ui.search, "temporary");
    assert.equal(ui.filterMode, "unowned");
    assert.deepEqual(ui.rarityFilter, [3]);
  });
});
