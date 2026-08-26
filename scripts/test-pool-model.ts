import { emptyProfile, type CharacterBuild, type Profile } from "../src/types/profile";
import { setCatalogForTesting } from "../src/utils/catalog";
import { fixtureCharacters, fixturePsychubes } from "./test-fixtures";
import {
  beginPoolDefaults,
  commitPoolDefaults,
  createPoolView,
  createPoolUiState,
  normalizeRarityFilter,
  reducePoolUi,
  summarizePsychubeOwnership,
} from "../src/utils/pool-model";

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

const character = fixtureCharacters[0];
const secondCharacter = fixtureCharacters[1];
const futureCharacter = fixtureCharacters.find((item) => !item.released)!;
const releasedPsychube = fixturePsychubes.find((item) => item.released)!;
const futurePsychube = fixturePsychubes.find((item) => !item.released)!;
const baseBuild: CharacterBuild = {
  insight: 1,
  level: 40,
  portray: 2,
  resonance: 5,
  activeVariant: null,
};
function poolProfile(): Profile {
  const profile = emptyProfile();
  profile.characters[character.id] = { ...baseBuild };
  profile.characters[futureCharacter.id] = { ...baseBuild };
  profile.psychubes[releasedPsychube.id] = 2;
  profile.psychubes[futurePsychube.id] = 3;
  return profile;
}

const profile = poolProfile();
const releasedView = createPoolView({
  profile,
  tab: "characters",
  search: "",
  filterMode: "all",
  rarityFilter: [],
  revealFuture: false,
});
const futureView = createPoolView({
  profile,
  tab: "characters",
  search: "future character",
  filterMode: "all",
  rarityFilter: [],
  revealFuture: true,
});
check(
  "character Pool visibility and search are normalized",
  !releasedView.characters.some(({ definition }) => definition.id === futureCharacter.id) &&
    futureView.characters.length === 1 &&
    futureView.characters[0].definition.id === futureCharacter.id,
);
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
check(
  "character ownership filters return normalized owned state",
  ownedView.characters.every(({ owned }) => owned) &&
    ownedView.characters.some(({ definition }) => definition.id === character.id) &&
    unownedView.characters.every(({ owned }) => !owned) &&
    unownedView.characters.some(({ definition }) => definition.id === secondCharacter.id),
);
check(
  "Pool exposes tab-specific rarity options and drops retained invalid values",
  JSON.stringify(normalizeRarityFilter("psychubes", [2, 3, 6, 7])) ===
    JSON.stringify([3, 6]) &&
    JSON.stringify(releasedView.rarityOptions) === JSON.stringify([2, 3, 4, 5, 6]),
);
const psychubeView = createPoolView({
  profile,
  tab: "psychubes",
  search: "",
  filterMode: "all",
  rarityFilter: [2],
  revealFuture: false,
});
check(
  "psychube Pool normalizes excluded rarity filters and ownership",
  psychubeView.visibleRarityFilter.length === 0 &&
    psychubeView.psychubes.length === 4 &&
    psychubeView.psychubes.find(
      ({ definition }) => definition.id === releasedPsychube.id,
    )?.amplification === 2 &&
    psychubeView.psychubeOwnership.visibleCount === 4 &&
    psychubeView.psychubeOwnership.ownedCount === 1,
);
const emptyOwnership = summarizePsychubeOwnership(emptyProfile(), false);
const completeOwnership = emptyProfile();
for (const item of fixturePsychubes) completeOwnership.psychubes[item.id] = 1;
check(
  "psychube ownership summary distinguishes empty and complete visible pools",
  emptyOwnership.status === "unowned" &&
    summarizePsychubeOwnership(completeOwnership, true).status === "owned",
);

let ui = createPoolUiState();
ui = reducePoolUi(ui, { type: "setTab", tab: "psychubes" });
ui = reducePoolUi(ui, { type: "setSearch", search: "藝術" });
ui = reducePoolUi(ui, { type: "setFilterMode", filterMode: "unowned" });
ui = reducePoolUi(ui, { type: "setRarityFilter", rarityFilter: [5, 6] });
ui = reducePoolUi(ui, {
  type: "setAssignment",
  assignment: { team: 1, slot: 2, kind: "character" },
});
const assignmentStarted = ui;
ui = reducePoolUi(ui, { type: "setTab", tab: "psychubes" });
ui = reducePoolUi(ui, { type: "setSearch", search: "temporary" });
ui = reducePoolUi(ui, { type: "setFilterMode", filterMode: "all" });
ui = reducePoolUi(ui, { type: "setRarityFilter", rarityFilter: [3] });
ui = reducePoolUi(ui, { type: "setAssignment", assignment: null });
check(
  "assignment restores only the prior filter and preserves other Pool changes",
  assignmentStarted.tab === "characters" &&
    assignmentStarted.filterMode === "owned" &&
    assignmentStarted.assignmentPreviousFilter === "unowned" &&
    ui.assignment === null &&
    ui.tab === "psychubes" &&
    ui.search === "temporary" &&
    ui.filterMode === "unowned" &&
    JSON.stringify(ui.rarityFilter) === JSON.stringify([3]) &&
    ui.assignmentPreviousFilter === null,
);

const sourceDefaults = {
  addDefaults: {
    insight: 0 as const,
    level: 1,
    portray: 0,
    resonance: 1,
  },
  defaultSkinMode: "initial" as const,
  psychubeAmplificationDefault: 1,
  psychubeOwnershipStatus: null,
};
const draft = beginPoolDefaults(sourceDefaults);
draft.addDefaults.level = 60;
draft.defaultSkinMode = "insight";
draft.psychubeAmplificationDefault = 5;
const characterCommit = commitPoolDefaults("characters", draft);
const psychubeCommit = commitPoolDefaults("psychubes", {
  ...draft,
  psychubeOwnershipStatus: "owned",
});
check(
  "defaults draft is isolated until Done commits the selected tab",
  sourceDefaults.addDefaults.level === 1 &&
    sourceDefaults.defaultSkinMode === "initial" &&
    sourceDefaults.psychubeAmplificationDefault === 1 &&
    characterCommit.tab === "characters" &&
    characterCommit.addDefaults.level === 60 &&
    characterCommit.defaultSkinMode === "insight" &&
    psychubeCommit.tab === "psychubes" &&
    psychubeCommit.psychubeAmplificationDefault === 5 &&
    psychubeCommit.psychubeOwnershipStatus === "owned",
);
const cancelledDraft = beginPoolDefaults(sourceDefaults);
cancelledDraft.addDefaults.level = 60;
check(
  "cancelled or outside-closed defaults drafts have no committed effect",
  sourceDefaults.addDefaults.level === 1 && cancelledDraft.addDefaults.level === 60,
);

console.log(`\npool model tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
