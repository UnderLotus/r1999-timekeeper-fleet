import type { LangCode } from "../i18n/ui";
import { getUiText } from "../i18n/ui";
import type { Profile, Team } from "../types/profile";
import { assetSrc } from "../utils/assets";
import { allCharacters, psychubesByRarityAndRecency } from "../utils/catalog";
import { cx } from "../utils/design";
import {
  presentCharacter,
  presentPsychube,
  presentTeamSlot,
} from "../utils/presentation";
import { AssetIcon } from "./AssetIcon";
import { InsightGlyph } from "./InsightGlyph";
import { PortrayBadge } from "./PortrayBadge";
import { PortraitPortray } from "./PortraitPortray";
import { ResonanceIcon } from "./ResonanceIcon";

export type ExportMode = "teams" | "pool" | "both";

function ExportTeam({
  team,
  index,
  profile,
  lang,
  revealFuture,
}: {
  team: Team;
  index: number;
  profile: Profile;
  lang: LangCode;
  revealFuture: boolean;
}): React.JSX.Element {
  const t = (key: string, params?: Record<string, string | number>) =>
    getUiText(lang, key, params);
  return (
    <article className="paper team-panel export-team">
      <header className="team-panel__head export-team__head">
        <h3>{team.name || t("teamN", { n: index + 1 })}</h3>
      </header>
      <div className="team-panel__slots">
        {team.slots.map((slot, slotIndex) => {
          const presentation = presentTeamSlot(
              slot,
              profile,
              lang,
              revealFuture,
              t("hiddenFutureSlot"),
            ),
            character = presentation.character,
            definition = character?.definition,
            build = character?.build,
            hidden = character?.hidden ?? false,
            variant = character?.variant,
            psychubeSlots = definition?.psychubeSlots ?? 1,
            psychubeViews = presentation.psychubes.slice(0, psychubeSlots),
            psychubeNames = psychubeViews.flatMap((view) =>
              view?.definition ? [view.name] : [],
            );

          return (
            <div
              className={cx(
                "team-slot",
                !definition && "team-slot--empty",
                hidden && "team-slot--hidden",
              )}
              key={slotIndex}
            >
              <div className="team-slot__character">
                <span className="team-slot__avatar">
                  <span className="team-slot__pos">{slotIndex + 1}</span>
                  {definition && build && variant && !hidden ? (
                    <>
                      <AssetIcon
                        kind="character"
                        id={variant.id}
                        alt={character!.name}
                        loading="eager"
                      />
                      <PortrayBadge
                        portray={build.portray}
                        className="team-slot__portray"
                      />
                    </>
                  ) : hidden ? (
                    <span className="team-slot__spoiler">?</span>
                  ) : null}
                </span>
                <span className="team-slot__summary">
                  <span className="team-slot__name">
                    {definition && !hidden
                      ? character!.name
                      : hidden
                        ? t("hiddenFutureSlot")
                        : ""}
                  </span>
                  {definition && build && !hidden && (
                    <span className="team-slot__meta">
                      <InsightGlyph insight={build.insight} tone="ink" />
                      <span>Lv.{build.level}</span>
                      <span
                        className="resonance-stat"
                        aria-label={`${t("resonance")} ${build.resonance}`}
                      >
                        <ResonanceIcon size={14} aria-hidden="true" />
                        {build.resonance}
                      </span>
                    </span>
                  )}
                </span>
              </div>
              {definition && build && !hidden && (
                <div className="team-slot__psychubes">
                  {psychubeViews.map((psychubeView, psyIndex) => {
                    const psychube = psychubeView?.definition,
                      psychubeHidden = psychubeView?.hidden ?? false;
                    return (
                      <span
                        className={cx(
                          "team-slot__psy",
                          !psychube && "team-slot__psy--empty",
                          psychubeHidden && "team-slot__psy--hidden",
                        )}
                        key={psyIndex}
                      >
                        {psychube && !psychubeHidden ? (
                          <AssetIcon
                            kind="psychube"
                            id={psychube.id}
                            alt={psychubeView!.name}
                            loading="eager"
                          />
                        ) : psychubeHidden ? (
                          "?"
                        ) : null}
                      </span>
                    );
                  })}
                  {psychubeNames.length > 0 && (
                    <span
                      className={cx(
                        "export-team__psychube-names",
                        psychubeNames.length > 1 &&
                          "export-team__psychube-names--dual",
                      )}
                    >
                      {psychubeNames.map((name, nameIndex) => (
                        <span
                          className="export-team__psychube-name"
                          title={name}
                          key={nameIndex}
                        >
                          {name}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function ExportCanvas({
  profile,
  lang,
  mode,
  revealFuture,
}: {
  profile: Profile;
  lang: LangCode;
  mode: ExportMode;
  revealFuture: boolean;
}): React.JSX.Element {
  const showTeams = mode !== "pool",
    showPool = mode !== "teams",
    t = (key: string, params?: Record<string, string | number>) =>
      getUiText(lang, key, params),
    activeTeams = profile.teams
      .map((team, index) => ({ team, index }))
      .filter(({ team }) => team.slots.some((slot) => slot.characterId)),
    ownedCharacters = allCharacters().filter(
      (definition) =>
        profile.characters[definition.id] &&
        (revealFuture || definition.released),
    ),
    ownedPsychubes = psychubesByRarityAndRecency().flatMap((definition) => {
      const imprint = profile.psychubes[definition.id];
      return imprint && (revealFuture || definition.released)
        ? [{ definition, imprint }]
        : [];
    }),
    hasExportContent =
      (showTeams && activeTeams.length > 0) ||
      (showPool && (ownedCharacters.length > 0 || ownedPsychubes.length > 0));

  return (
    <div className="export-canvas">
      <header className="export-canvas__header">
        <div className="export-canvas__identity">
          <span className="export-canvas__eyebrow">TIMEKEEPER FLEET</span>
          <h1>
            <span className="export-canvas__wordmark">REVERSE: 1999</span>
            <span className="export-canvas__localized-title">
              {t("appTitle").replace(/^REVERSE:\s*1999\s*/i, "")}
            </span>
          </h1>
        </div>
        <div className="export-canvas__project-link">
          <div className="export-canvas__project-copy">
            <span className="export-canvas__project-label">PROJECT PAGE</span>
            <span className="export-canvas__project-url">
              underlotus.github.io/r1999-timekeeper-fleet/
            </span>
          </div>
          <img
            className="export-canvas__project-qr"
            src={assetSrc("/assets/ui/project-qrcode.svg")}
            alt="Project homepage QR code"
            loading="eager"
            decoding="sync"
          />
        </div>
      </header>

      {!hasExportContent ? (
        <div className="export-canvas__nothing">
          <img
            className="export-canvas__nothing-image"
            src={assetSrc("/assets/ui/vertin_question.webp")}
            alt=""
            loading="eager"
            decoding="async"
          />
          <div className="export-canvas__nothing-copy">
            <p>{t("exportNothingTitle")}</p>
            <p>{t("exportNothingHint")}</p>
          </div>
        </div>
      ) : (
        <>
          {showTeams && (
            <section className="export-section">
              <div className="export-section__heading">
                <h2>{t("teams")}</h2>
              </div>
              {activeTeams.length ? (
                <div className="team-board export-team-board">
                  {activeTeams.map(({ team, index }) => (
                    <ExportTeam
                      key={index}
                      team={team}
                      index={index}
                      profile={profile}
                      lang={lang}
                      revealFuture={revealFuture}
                    />
                  ))}
                </div>
              ) : (
                <div className="export-empty">{t("emptySlot")}</div>
              )}
            </section>
          )}

          {showPool && (
            <section className="export-section">
              <div className="export-section__heading">
                <h2>{t("ownedCharacters")}</h2>
              </div>
              {ownedCharacters.length ? (
                <div className="pool-grid export-pool">
                  {ownedCharacters.map((definition) => {
                    const build = profile.characters[definition.id],
                      presentation = presentCharacter(
                        definition,
                        build,
                        lang,
                        revealFuture,
                        t("hiddenFutureSlot"),
                      ),
                      { variant, hidden, name } = presentation;
                    return (
                      <article
                        className="char-card char-card--owned export-character-card"
                        key={definition.id}
                      >
                        <div className="char-card__portrait">
                          {hidden ? (
                            <span className="export-hidden-mark">?</span>
                          ) : (
                            <>
                              <AssetIcon
                                kind="character"
                                id={variant.id}
                                alt={name}
                                loading="eager"
                              />
                              <PortraitPortray build={build} />
                            </>
                          )}
                        </div>
                        <div className="char-card__name">{name}</div>
                        {!hidden && (
                          <div className="char-card__level">
                            LV. {build.level}
                          </div>
                        )}
                        {!hidden && (
                          <div className="char-card__meta">
                            <span className="char-card__meta-item">
                              <InsightGlyph
                                insight={build.insight}
                                tone="ink"
                              />
                            </span>
                            <span className="char-card__meta-item resonance-stat">
                              <ResonanceIcon size={14} aria-hidden="true" />
                              {build.resonance}
                            </span>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="export-empty">{t("emptyPool")}</div>
              )}

              <div className="export-section__heading export-section__heading--nested">
                <h2>{t("ownedPsychubes")}</h2>
              </div>
              {ownedPsychubes.length ? (
                <div className="pool-grid export-pool">
                  {ownedPsychubes.map(({ definition, imprint }) => {
                    const { hidden, name } = presentPsychube(
                      definition,
                      lang,
                      revealFuture,
                      t("hiddenFutureSlot"),
                    );
                    return (
                      <article
                        className="psy-card psy-card--owned export-psychube-card"
                        key={definition.id}
                      >
                        <span className="psy-card__frame">
                          {hidden ? (
                            <span className="export-hidden-mark">?</span>
                          ) : (
                            <AssetIcon
                              kind="psychube"
                              id={definition.id}
                              alt={name}
                              loading="eager"
                            />
                          )}
                          {!hidden && imprint > 1 && (
                            <span className="psy-card__imprint">{imprint}</span>
                          )}
                        </span>
                        <span className="psy-card__name">{name}</span>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="export-empty">{t("emptyPool")}</div>
              )}
            </section>
          )}
        </>
      )}

      <footer className="export-canvas__footer">
        <span>underlotus.github.io</span>
        <span>R1999 TIMEKEEPER FLEET</span>
      </footer>
    </div>
  );
}
