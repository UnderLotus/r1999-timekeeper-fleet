import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CharacterCard } from "../../src/components/CharacterCard";
import {
  ExportCanvas,
  type ExportMode,
} from "../../src/components/ExportCanvas";
import { LangSwitcher } from "../../src/components/LangSwitcher";
import { PoolControls } from "../../src/components/PoolControls";
import { PsychubeCard } from "../../src/components/PsychubeCard";
import { ShareDialog } from "../../src/components/ShareDialog";
import { TeamBoard } from "../../src/components/TeamBoard";
import { TopBar } from "../../src/components/TopBar";
import { getUiText } from "../../src/i18n/ui";
import { ADD_DEFAULT } from "../../src/store/boxStore";
import type { LangCode } from "../../src/types/catalog";
import { emptyProfile, type Profile } from "../../src/types/profile";
import { setCatalogForTesting } from "../../src/utils/catalog";
import { poolRarityOptions } from "../../src/utils/pool-model";
import {
  CHAR_FUTURE,
  CHAR_MISTLETOE,
  CHAR_TWINS,
  fixtureCharacters,
  fixturePsychubes,
  PSY_ART,
  PSY_FUTURE,
  PSY_NECESSARY,
  PSY_SCIENCE,
} from "../helpers/catalog-fixtures";

const noop = () => {};

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

function buildFutureProfile(): Profile {
  const profile = emptyProfile();
  profile.characters[CHAR_MISTLETOE.id] = {
    ...ADD_DEFAULT,
    activeVariant: null,
  };
  profile.characters[CHAR_FUTURE.id] = {
    ...ADD_DEFAULT,
    activeVariant: null,
  };
  profile.psychubes[PSY_NECESSARY.id] = 2;
  profile.psychubes[PSY_FUTURE.id] = 3;
  profile.teams[0].slots[0] = {
    characterId: CHAR_MISTLETOE.id,
    psychubeId: PSY_FUTURE.id,
    psychubeId2: null,
  };
  profile.teams[0].slots[1] = {
    characterId: CHAR_FUTURE.id,
    psychubeId: PSY_NECESSARY.id,
    psychubeId2: null,
  };
  return profile;
}

function buildDualProfile(): Profile {
  const profile = emptyProfile();
  profile.characters[CHAR_TWINS.id] = { ...ADD_DEFAULT, activeVariant: null };
  profile.psychubes[PSY_ART.id] = 4;
  profile.psychubes[PSY_SCIENCE.id] = 1;
  profile.teams[0].slots[0] = {
    characterId: CHAR_TWINS.id,
    psychubeId: PSY_ART.id,
    psychubeId2: PSY_SCIENCE.id,
  };
  return profile;
}

function renderTeam(
  profile: Profile,
  revealFuture: boolean,
  lang: LangCode = "en-US",
): string {
  return renderToStaticMarkup(
    <TeamBoard
      profile={profile}
      lang={lang}
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
  profile: Profile,
  mode: ExportMode,
  lang: LangCode = "en-US",
  revealFuture = false,
): string {
  return renderToStaticMarkup(
    <ExportCanvas
      profile={profile}
      lang={lang}
      mode={mode}
      revealFuture={revealFuture}
    />,
  );
}

describe("UI & export rendering contracts (docs/DESIGN.md)", () => {
  beforeEach(() => {
    setCatalogForTesting(fixtureCharacters, fixturePsychubes);
  });

  it("hides future characters and future psychubes in TeamBoard when Future Sight is off and reveals them when on", () => {
    const profile = buildFutureProfile();
    const hidden = renderTeam(profile, false);
    const visible = renderTeam(profile, true);

    assert.equal(hidden.includes("Future Character"), false);
    assert.equal(hidden.includes(`/characters/${CHAR_FUTURE.defaultVariant}.webp`), false);
    assert.equal(hidden.includes("Future Psychube"), false);
    assert.equal(hidden.includes(`/psychubes/${PSY_FUTURE.id}.webp`), false);
    assert.equal(hidden.includes('class="psy-card__imprint"'), false);

    assert.ok(visible.includes("Future Character"));
    assert.ok(visible.includes("Future Psychube"));
    assert.ok(visible.includes(`/psychubes/${PSY_FUTURE.id}.webp`));
    assert.ok(visible.includes('<span class="psy-card__imprint">3</span>'));
    assert.ok(
      visible.includes('aria-label="Future Psychube · Amplification 3"'),
    );
  });

  it("renders dual team psychubes with amplification badges (omitting level 1) and localized assistive labels", () => {
    const dualTeam = renderTeam(buildDualProfile(), true, "zh-TW");
    assert.ok(dualTeam.includes('<span class="psy-card__imprint">4</span>'));
    assert.equal(
      dualTeam.includes('<span class="psy-card__imprint">1</span>'),
      false,
    );
    assert.ok(dualTeam.includes('aria-label="藝術原子能 · 增幅 4"'));
    assert.ok(dualTeam.includes('aria-label="科學編舞法 · 增幅 1"'));

    const localizedTeam = renderTeam(buildFutureProfile(), true, "zh-TW");
    assert.ok(
      localizedTeam.includes(`aria-label="${getUiText("zh-TW", "teams")}"`),
    );
    assert.ok(
      localizedTeam.includes(
        `aria-label="${getUiText("zh-TW", "clearSlotLabel", { team: 1, slot: 1 })}"`,
      ),
    );
    assert.ok(
      localizedTeam.includes(`aria-label="${getUiText("zh-TW", "moveRight")}"`),
    );
    assert.equal(localizedTeam.includes('aria-label="teams"'), false);
    assert.equal(localizedTeam.includes('aria-label="move right"'), false);
  });

  it("respects Future Sight, omits empty teams, preserves dual psychube order, and eager-loads all images in ExportCanvas", () => {
    const profile = buildFutureProfile();
    const hiddenExport = renderExport(profile, "both", "en-US", false);
    const visibleExport = renderExport(profile, "both", "en-US", true);

    assert.equal(hiddenExport.includes("Future Character"), false);
    assert.equal(hiddenExport.includes("Future Psychube"), false);
    assert.ok(hiddenExport.includes("Mistletoe"));

    assert.ok(visibleExport.includes("Future Character"));
    assert.ok(visibleExport.includes("Future Psychube"));
    assert.ok(visibleExport.includes(`/psychubes/${PSY_FUTURE.id}.webp`));
    assert.ok(visibleExport.includes(getUiText("en-US", "teamN", { n: 1 })));
    assert.equal(
      visibleExport.includes(getUiText("en-US", "teamN", { n: 2 })),
      false,
    );
    assert.equal(allImagesHaveEagerLoading(visibleExport), true);

    const dualExport = renderExport(buildDualProfile(), "teams", "zh-TW", true);
    assert.ok(dualExport.includes("藝術原子能"));
    assert.ok(dualExport.includes("科學編舞法"));
    assert.ok(
      dualExport.indexOf("藝術原子能") < dualExport.indexOf("科學編舞法"),
    );
    assert.ok(dualExport.includes('<span class="psy-card__imprint">4</span>'));
    assert.equal(
      dualExport.includes('<span class="psy-card__imprint">1</span>'),
      false,
    );
  });

  it("renders the Vertin easter egg with header/footer for empty selected scopes, while counting owned psychubes as Pool content", () => {
    const empty = emptyProfile();
    const poolOnly = emptyProfile();
    poolOnly.characters[CHAR_MISTLETOE.id] = {
      ...ADD_DEFAULT,
      activeVariant: null,
    };

    for (const markup of [
      renderExport(empty, "teams", "zh-TW"),
      renderExport(empty, "pool", "zh-TW"),
      renderExport(empty, "both", "zh-TW"),
      renderExport(poolOnly, "teams", "zh-TW"),
    ]) {
      assert.ok(markup.includes("/assets/ui/vertin_question.webp"));
      assert.ok(markup.includes(getUiText("zh-TW", "exportNothingTitle")));
      assert.ok(markup.includes(getUiText("zh-TW", "exportNothingHint")));
      assert.equal(markup.includes("<section"), false);
      assert.ok(markup.includes("<header"));
      assert.ok(markup.includes("<footer"));
      assert.equal(allImagesHaveEagerLoading(markup), true);
    }

    const psychubeOnly = emptyProfile();
    psychubeOnly.psychubes[PSY_NECESSARY.id] = 1;
    const psychubeOnlyExport = renderExport(psychubeOnly, "pool");
    assert.ok(psychubeOnlyExport.includes("Necessary Records"));
    assert.equal(
      psychubeOnlyExport.includes(getUiText("en-US", "exportNothingTitle")),
      false,
    );
  });

  it("enforces PoolControls, card, ShareDialog, TopBar, and LangSwitcher accessibility contracts", () => {
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
        rarityOptions={poolRarityOptions("psychubes")}
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
    assert.equal(psychubeControls.includes("★2"), false);
    for (const star of ["★3", "★4", "★5", "★6"])
      assert.ok(psychubeControls.includes(star));

    const unownedCard = renderToStaticMarkup(
      <PsychubeCard
        def={PSY_NECESSARY}
        imprint={0}
        lang="en-US"
        onAdd={noop}
        onSetImprint={noop}
        onRemove={noop}
      />,
    );
    const maxCard = renderToStaticMarkup(
      <PsychubeCard
        def={PSY_NECESSARY}
        imprint={5}
        lang="en-US"
        onAdd={noop}
        onSetImprint={noop}
        onRemove={noop}
      />,
    );
    const assignableMaxCard = renderToStaticMarkup(
      <PsychubeCard
        def={PSY_NECESSARY}
        imprint={5}
        lang="en-US"
        onAdd={noop}
        onSetImprint={noop}
        onRemove={noop}
        onAssign={noop}
      />,
    );
    assert.ok(unownedCard.includes("Amplification 0 → 1"));
    assert.ok(maxCard.includes('aria-disabled="true"'));
    assert.equal(assignableMaxCard.includes('aria-disabled="true"'), false);

    const localizedCharacter = renderToStaticMarkup(
      <CharacterCard
        def={CHAR_MISTLETOE}
        build={{ ...ADD_DEFAULT, activeVariant: null }}
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
    assert.ok(
      localizedCharacter.includes(
        getUiText("zh-TW", "editCharacterNamed", { name: "槲寄生" }),
      ),
    );
    assert.ok(
      localizedCharacter.includes(
        getUiText("zh-TW", "openSkinNamed", { name: "槲寄生" }),
      ),
    );
    assert.ok(
      localizedCharacter.includes(
        getUiText("zh-TW", "removeCharacterNamed", { name: "槲寄生" }),
      ),
    );
    assert.equal(localizedCharacter.includes("Edit Mistletoe"), false);

    const shareMarkup = renderToStaticMarkup(
      <ShareDialog
        url="https://example.test/#p=abc"
        lang="en-US"
        onClose={noop}
      />,
    );
    assert.ok(shareMarkup.includes("<input"));
    assert.ok(shareMarkup.includes('readonly=""'));
    assert.ok(shareMarkup.includes('value="https://example.test/#p=abc"'));
    assert.ok(shareMarkup.includes(getUiText("en-US", "copyUrl")));

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
    assert.match(
      openingButtonTag(busyTopBar, getUiText("en-US", "export")),
      /\sdisabled(?:=""|(?=[\s>]))/,
    );
    assert.equal(busyTopBar.includes("share-copy-toast"), false);

    const copiedTopBar = renderToStaticMarkup(
      <TopBar
        lang="zh-TW"
        showFutureSight={false}
        shareCopied
        exportDisabled={false}
        onLang={noop}
        onFuture={noop}
        onReset={noop}
        onShare={noop}
        onExport={noop}
      />,
    );
    assert.ok(copiedTopBar.includes('class="share-copy-toast"'));
    assert.ok(copiedTopBar.includes('role="status"'));
    assert.ok(copiedTopBar.includes('aria-live="polite"'));
    assert.ok(copiedTopBar.includes('aria-atomic="true"'));
    assert.ok(copiedTopBar.includes(getUiText("zh-TW", "urlCopied")));

    const switcher = renderToStaticMarkup(
      <LangSwitcher value="ja-JP" onChange={noop} />,
    );
    for (const label of ["CN", "TW", "EN", "JP", "KR"])
      assert.ok(switcher.includes(`>${label}</button>`));
    assert.ok(openingButtonTag(switcher, "JP").includes('aria-pressed="true"'));
  });
});
