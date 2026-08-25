import { renderToStaticMarkup } from "react-dom/server";

import { CharacterCard } from "../src/components/CharacterCard";
import { ExportCanvas, type ExportMode } from "../src/components/ExportCanvas";
import { LangSwitcher } from "../src/components/LangSwitcher";
import { getUiText } from "../src/i18n/ui";
import { PoolControls } from "../src/components/PoolControls";
import { PoolGrid } from "../src/components/PoolGrid";
import { PsychubeCard } from "../src/components/PsychubeCard";
import { ShareDialog } from "../src/components/ShareDialog";
import { TeamBoard } from "../src/components/TeamBoard";
import { TopBar } from "../src/components/TopBar";
import { ADD_DEFAULT } from "../src/store/boxStore";
import type { LangCode } from "../src/types/catalog";
import { emptyProfile, type Profile } from "../src/types/profile";
import {
  characterName,
  psychubeName,
  setCatalogForTesting,
} from "../src/utils/catalog";
import { fixtureCharacters, fixturePsychubes } from "./test-fixtures";

setCatalogForTesting(fixtureCharacters, fixturePsychubes);
const noop = () => {};
const character = fixtureCharacters[0];
const futureCharacter = fixtureCharacters.find((item) => !item.released)!;
const futurePsychube = fixturePsychubes.find((item) => !item.released)!;
const releasedPsychube = fixturePsychubes.find((item) => item.released)!;
const twins = fixtureCharacters.find((item) => item.id === "3149")!;
const artPsychube = fixturePsychubes.find((item) => item.id === "1571")!;
const sciencePsychube = fixturePsychubes.find((item) => item.id === "1572")!;

const profile = emptyProfile();
profile.characters[character.id] = { ...ADD_DEFAULT, activeVariant: null };
profile.characters[futureCharacter.id] = {
  ...ADD_DEFAULT,
  activeVariant: null,
};
profile.psychubes[releasedPsychube.id] = 2;
profile.psychubes[futurePsychube.id] = 3;
profile.teams[0].slots[0] = {
  characterId: character.id,
  psychubeId: futurePsychube.id,
  psychubeId2: null,
};

const dualProfile = emptyProfile();
dualProfile.characters[twins.id] = { ...ADD_DEFAULT, activeVariant: null };
dualProfile.psychubes[artPsychube.id] = 4;
dualProfile.psychubes[sciencePsychube.id] = 1;
dualProfile.teams[0].slots[0] = {
  characterId: twins.id,
  psychubeId: artPsychube.id,
  psychubeId2: sciencePsychube.id,
};

function renderTeam(
  revealFuture: boolean,
  teamProfile: Profile = profile,
  teamLang: LangCode = "en-US",
): string {
  return renderToStaticMarkup(
    <TeamBoard
      profile={teamProfile}
      lang={teamLang}
      revealFuture={revealFuture}
      assignment={null}
      onSlotClick={noop}
      onSwap={noop}
      onClearSlot={noop}
      onClearTeam={noop}
      onTeamName={noop}
    />,
  );
}

function renderExport(
  exportProfile: Profile,
  mode: ExportMode,
  lang: LangCode = "en-US",
  revealFuture = false,
): string {
  return renderToStaticMarkup(
    <ExportCanvas
      profile={exportProfile}
      lang={lang}
      mode={mode}
      revealFuture={revealFuture}
    />,
  );
}

function renderPsychubePool(poolProfile: Profile): string {
  return renderToStaticMarkup(
    <PoolGrid
      tab="psychubes"
      lang="en-US"
      revealFuture
      ownedCharacters={poolProfile.characters}
      psychubes={poolProfile.psychubes}
      search=""
      filterMode="all"
      rarityFilter={[]}
      assignment={null}
      onAddCharacter={noop}
      onOpenEditor={noop}
      onOpenSkin={noop}
      onRemoveCharacter={noop}
      onSetInsight={noop}
      onSetResonance={noop}
      onPickCharacter={noop}
      onPickPsychube={noop}
      onSetPsychubeImprint={noop}
      onRemovePsychube={noop}
      onAddPsychube={noop}
    />,
  );
}

const psychubeControls = renderToStaticMarkup(
  <PoolControls
    lang="en-US"
    tab="psychubes"
    search=""
    filterMode="all"
    rarityFilter={[]}
    addDefaults={ADD_DEFAULT}
    defaultSkinMode="initial"
    psychubeImprintDefault={1}
    psychubeOwnershipStatus="unowned"
    onTab={noop}
    onSearch={noop}
    onFilter={noop}
    onRarity={noop}
    onDefaults={noop}
    onDefaultSkinMode={noop}
    onPsychubeImprintDefault={noop}
    onSetAllPsychubesOwned={noop}
  />,
);
const syntheticThreeStarPsychube = {
  ...releasedPsychube,
  rarity: 2,
};
setCatalogForTesting(fixtureCharacters, [syntheticThreeStarPsychube]);
const psychubePoolWithHiddenTwoStarFilter = renderToStaticMarkup(
  <PoolGrid
    tab="psychubes"
    lang="en-US"
    revealFuture
    ownedCharacters={{}}
    psychubes={{}}
    search=""
    filterMode="all"
    rarityFilter={[2]}
    assignment={null}
    onAddCharacter={noop}
    onOpenEditor={noop}
    onOpenSkin={noop}
    onRemoveCharacter={noop}
    onSetInsight={noop}
    onSetResonance={noop}
    onPickCharacter={noop}
    onPickPsychube={noop}
    onSetPsychubeImprint={noop}
    onRemovePsychube={noop}
    onAddPsychube={noop}
  />,
);
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
check(
  "psychube rarity controls omit the material-only two-star tier",
  !psychubeControls.includes("★2") &&
    ["★3", "★4", "★5", "★6"].every((label) => psychubeControls.includes(label)),
);
check(
  "a retained character two-star filter does not empty the psychube pool",
  psychubePoolWithHiddenTwoStarFilter.includes(
    syntheticThreeStarPsychube.names["en-US"],
  ),
);
function openingButtonTag(markup: string, label: string): string {
  const labelIndex = markup.indexOf(label);
  const start = markup.lastIndexOf("<button", labelIndex);
  const end = markup.indexOf(">", start);
  return start >= 0 && end >= start ? markup.slice(start, end + 1) : "";
}
function allImagesHaveEagerLoading(markup: string): boolean {
  const images = markup.match(/<img\b[^>]*>/g) ?? [];
  return (
    images.length > 0 &&
    images.every((image) => /\sloading="eager"/.test(image))
  );
}

const hiddenTeam = renderTeam(false);
const visibleTeam = renderTeam(true);
const localizedTeam = renderToStaticMarkup(
  <TeamBoard
    profile={profile}
    lang="zh-TW"
    revealFuture
    assignment={null}
    onSlotClick={noop}
    onSwap={noop}
    onClearSlot={noop}
    onClearTeam={noop}
    onTeamName={noop}
  />,
);
const hiddenExport = renderExport(profile, "both");
const visibleExport = renderExport(profile, "both", "en-US", true);

check(
  "Future Sight off never leaks a future psychube name or asset from a team",
  !hiddenTeam.includes("Future Psychube") &&
    !hiddenTeam.includes(`/psychubes/${futurePsychube.id}.webp`),
);
check(
  "Future Sight on reveals the assigned future psychube",
  visibleTeam.includes("Future Psychube") &&
    visibleTeam.includes(`/psychubes/${futurePsychube.id}.webp`),
);
check(
  "team psychube uses the Pool amplification badge and accessible label",
  visibleTeam.includes('<span class="psy-card__imprint">3</span>') &&
    visibleTeam.includes('aria-label="Future Psychube · Amplification 3"') &&
    !hiddenTeam.includes('class="psy-card__imprint"'),
);
check(
  "team navigation and slot actions use localized assistive labels",
  localizedTeam.includes(`aria-label="${getUiText("zh-TW", "teams")}"`) &&
    localizedTeam.includes(
      `aria-label="${getUiText("zh-TW", "clearSlotLabel", { team: 1, slot: 1 })}"`,
    ) &&
    localizedTeam.includes(`aria-label="${getUiText("zh-TW", "moveRight")}"`) &&
    !localizedTeam.includes('aria-label="teams"') &&
    !localizedTeam.includes('aria-label="move right"'),
);
check(
  "Pool export omits unreleased owned records while Future Sight is off",
  !hiddenExport.includes("Future Character") &&
    !hiddenExport.includes("Future Psychube") &&
    hiddenExport.includes(character.names["en-US"]),
);
check(
  "export reveals future records only when Future Sight is on",
  visibleExport.includes("Future Character") &&
    visibleExport.includes("Future Psychube") &&
    visibleExport.includes(`/psychubes/${futurePsychube.id}.webp`),
);
check(
  "export omits teams without an assigned character",
  visibleExport.includes(getUiText("en-US", "teamN", { n: 1 })) &&
    !visibleExport.includes(getUiText("en-US", "teamN", { n: 2 })),
);

const dualTeam = renderTeam(true, dualProfile, "zh-TW");
check(
  "dual team psychubes show each owned amplification without a level-one badge",
  dualTeam.includes('<span class="psy-card__imprint">4</span>') &&
    !dualTeam.includes('<span class="psy-card__imprint">1</span>') &&
    dualTeam.includes('aria-label="藝術原子能 · 增幅 4"') &&
    dualTeam.includes('aria-label="科學編舞法 · 增幅 1"'),
);

const dualExport = renderExport(dualProfile, "teams", "zh-TW", true);
check(
  "dual psychube names and amplification keep equipment order in team exports",
  dualExport.includes("藝術原子能") &&
    dualExport.includes("科學編舞法") &&
    dualExport.indexOf("藝術原子能") < dualExport.indexOf("科學編舞法") &&
    dualExport.includes('<span class="psy-card__imprint">4</span>') &&
    !dualExport.includes('<span class="psy-card__imprint">1</span>'),
);

const emptyProfileValue = emptyProfile();
const poolOnly = emptyProfile();
poolOnly.characters[character.id] = { ...ADD_DEFAULT, activeVariant: null };
const psychubeOnly = emptyProfile();
psychubeOnly.psychubes[releasedPsychube.id] = 1;
const emptySelectedScopes = [
  renderExport(emptyProfileValue, "teams", "zh-TW"),
  renderExport(emptyProfileValue, "pool", "zh-TW"),
  renderExport(emptyProfileValue, "both", "zh-TW"),
  renderExport(poolOnly, "teams", "zh-TW"),
];
check(
  "an empty selected export scope uses the Vertin easter egg and no sections",
  emptySelectedScopes.every(
    (markup) =>
      markup.includes("/assets/ui/vertin_question.webp") &&
      markup.includes(getUiText("zh-TW", "exportNothingTitle")) &&
      markup.includes(getUiText("zh-TW", "exportNothingHint")) &&
      !markup.includes("<section"),
  ),
);
check(
  "the empty easter egg keeps the export header and footer",
  emptySelectedScopes.every(
    (markup) => markup.includes("<header") && markup.includes("<footer"),
  ),
);
const psychubeOnlyExport = renderExport(psychubeOnly, "pool");
check(
  "owned psychubes count as Pool content even without characters",
  psychubeOnlyExport.includes(releasedPsychube.names["en-US"]) &&
    !psychubeOnlyExport.includes(getUiText("en-US", "exportNothingTitle")),
);
check(
  "every export image is eager-loaded before screenshotting",
  [visibleExport, ...emptySelectedScopes].every(allImagesHaveEagerLoading),
);

const unownedCard = renderToStaticMarkup(
  <PsychubeCard
    def={releasedPsychube}
    imprint={0}
    lang="en-US"
    onAdd={noop}
    onSetImprint={noop}
    onRemove={noop}
  />,
);
const maxCard = renderToStaticMarkup(
  <PsychubeCard
    def={releasedPsychube}
    imprint={5}
    lang="en-US"
    onAdd={noop}
    onSetImprint={noop}
    onRemove={noop}
  />,
);
const assignableMaxCard = renderToStaticMarkup(
  <PsychubeCard
    def={releasedPsychube}
    imprint={5}
    lang="en-US"
    onAdd={noop}
    onSetImprint={noop}
    onRemove={noop}
    onAssign={noop}
  />,
);
check(
  "unowned psychube action announces the 0 to 1 transition",
  unownedCard.includes("Amplification 0 → 1"),
);
check(
  "max psychube is disabled for upgrades but remains assignable",
  maxCard.includes('aria-disabled="true"') &&
    !assignableMaxCard.includes('aria-disabled="true"'),
);

const psychubePool = renderPsychubePool(profile);
check(
  "psychube Pool groups higher rarity first and newest first within each rarity",
  psychubePool.indexOf("Future Psychube") <
    psychubePool.indexOf("Necessary Records") &&
    psychubePool.indexOf("Necessary Records") <
      psychubePool.indexOf("The Dance of Science") &&
    psychubePool.indexOf("The Dance of Science") <
      psychubePool.indexOf("The Art of Atoms") &&
    psychubePool.indexOf("The Art of Atoms") < psychubePool.indexOf("Joy"),
);

const localizedCharacter = renderToStaticMarkup(
  <CharacterCard
    def={character}
    build={profile.characters[character.id]}
    lang="zh-TW"
    revealFuture
    onAdd={noop}
    onOpenEditor={noop}
    onOpenSkin={noop}
    onRemove={noop}
    onSetInsight={noop}
    onSetResonance={noop}
  />,
);
check(
  "character actions use localized assistive labels",
  localizedCharacter.includes(
    getUiText("zh-TW", "editCharacterNamed", { name: "槲寄生" }),
  ) &&
    localizedCharacter.includes(
      getUiText("zh-TW", "openSkinNamed", { name: "槲寄生" }),
    ) &&
    localizedCharacter.includes(
      getUiText("zh-TW", "removeCharacterNamed", { name: "槲寄生" }),
    ) &&
    !localizedCharacter.includes("Edit Mistletoe"),
);

const shareMarkup = renderToStaticMarkup(
  <ShareDialog url="https://example.test/#p=abc" lang="en-US" onClose={noop} />,
);
check(
  "share fallback always exposes a readonly URL input and copy action",
  shareMarkup.includes("<input") &&
    shareMarkup.includes('readonly=""') &&
    shareMarkup.includes('value="https://example.test/#p=abc"') &&
    shareMarkup.includes(getUiText("en-US", "copyUrl")),
);

const busyTopBar = renderToStaticMarkup(
  <TopBar
    lang="en-US"
    showFutureSight={false}
    shareCopied={false}
    exportDisabled
    onLang={noop}
    onFuture={noop}
    onReset={noop}
    onShare={noop}
    onExport={noop}
  />,
);
check(
  "export action is disabled while capture is running",
  /\sdisabled(?:=""|(?=[\s>]))/.test(
    openingButtonTag(busyTopBar, getUiText("en-US", "export")),
  ),
);
const exportActionGroup =
  busyTopBar.match(
    /<div class="topbar__export-actions">([\s\S]*?)<\/div>/,
  )?.[1] ?? "";
check(
  "share and image export stay in one responsive action group",
  exportActionGroup.includes(getUiText("en-US", "share")) &&
    exportActionGroup.includes(getUiText("en-US", "export")) &&
    (exportActionGroup.match(/<button\b/g) ?? []).length === 2,
);

const partialCharacter = {
  ...character,
  names: {
    "en-US": "English fallback",
    "zh-CN": "中文後備",
  } as typeof character.names,
};
const chineseOnlyPsychube = {
  ...releasedPsychube,
  names: { "zh-CN": "中文心相" } as typeof releasedPsychube.names,
};
const unrelatedLocalePsychube = {
  ...releasedPsychube,
  names: { "ja-JP": "日本語だけ" } as typeof releasedPsychube.names,
};
check(
  "runtime names fall back requested to English to Simplified Chinese to canonical",
  characterName(partialCharacter, "ko-KR") === "English fallback" &&
    psychubeName(chineseOnlyPsychube, "ko-KR") === "中文心相" &&
    psychubeName(unrelatedLocalePsychube, "ko-KR") === releasedPsychube.id,
);

const switcher = renderToStaticMarkup(
  <LangSwitcher value="ja-JP" onChange={noop} />,
);
check(
  "language switcher exposes all five fixed choices and the active state",
  ["CN", "TW", "EN", "JP", "KR"].every((label) =>
    switcher.includes(`>${label}</button>`),
  ) && openingButtonTag(switcher, "JP").includes('aria-pressed="true"'),
);

const supportedLocales: LangCode[] = [
  "zh-CN",
  "zh-TW",
  "en-US",
  "ja-JP",
  "ko-KR",
];
check(
  "empty export copy renders in every supported language",
  supportedLocales.every((locale) => {
    const markup = renderExport(emptyProfileValue, "both", locale);
    return (
      markup.includes(getUiText(locale, "exportNothingTitle")) &&
      markup.includes(getUiText(locale, "exportNothingHint"))
    );
  }),
);

console.log(`\nrender tests: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
