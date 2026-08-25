import { ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LangCode } from "../i18n/ui";
import { getUiText } from "../i18n/ui";
import type { Assignment } from "../store/boxStore";
import {
  normalizeTeamName,
  TEAM_NAME_MAX_LENGTH,
  type Profile,
} from "../types/profile";
import {} from "../utils/catalog";
import { cx } from "../utils/design";
import { presentTeamSlot } from "../utils/presentation";
import { AssetIcon } from "./AssetIcon";
import { InsightGlyph } from "./InsightGlyph";
import { PortrayBadge } from "./PortrayBadge";
import { PsychubeAmplificationBadge } from "./PsychubeAmplificationBadge";
import { ResonanceIcon } from "./ResonanceIcon";

export function TeamBoard({
  profile,
  lang,
  revealFuture,
  assignment,
  onSlotClick,
  onSwap,
  onClearSlot,
  onClearTeam,
  onTeamName,
}: {
  profile: Profile;
  lang: LangCode;
  revealFuture: boolean;
  assignment: Assignment | null;
  onSlotClick: (
    team: number,
    slot: number,
    kind: "character" | "psychube",
    psychubeIndex?: 0 | 1,
  ) => void;
  onSwap: (team: number, a: number, b: number) => void;
  onClearSlot: (team: number, slot: number) => void;
  onClearTeam: (team: number) => void;
  onTeamName: (team: number, name: string) => void;
}): React.JSX.Element {
  const [selectedTeam, setSelectedTeam] = useState(0);
  const [nameWarnings, setNameWarnings] = useState<Record<number, boolean>>({});
  const nameWarningTimers = useRef<Record<number, number>>({});
  useEffect(
    () => () =>
      Object.values(nameWarningTimers.current).forEach((timer) =>
        window.clearTimeout(timer),
      ),
    [],
  );
  const displayedTeam = assignment?.team ?? selectedTeam;
  return (
    <section className="team-board" aria-label={getUiText(lang, "teams")}>
      <nav className="team-switcher" aria-label={getUiText(lang, "teams")}>
        {profile.teams.map((team, index) => (
          <button
            key={index}
            type="button"
            aria-pressed={displayedTeam === index}
            data-active={displayedTeam === index}
            onClick={() => setSelectedTeam(index)}
            title={team.name || getUiText(lang, "teamN", { n: index + 1 })}
          >
            <span>
              {team.name || getUiText(lang, "teamN", { n: index + 1 })}
            </span>
          </button>
        ))}
      </nav>
      {profile.teams.map((team, ti) => {
        const fallbackName = getUiText(lang, "teamN", { n: ti + 1 });
        return (
          <article
            key={ti}
            className="paper team-panel"
            data-mobile-active={displayedTeam === ti}
          >
            <header className="team-panel__head">
              <label className="team-panel__name-field">
                <span className="sr-only">{getUiText(lang, "teamName")}</span>
                <input
                  type="text"
                  value={team.name}
                  maxLength={TEAM_NAME_MAX_LENGTH * 2}
                  placeholder={fallbackName}
                  aria-label={`${getUiText(lang, "teamName")} ${ti + 1}`}
                  onChange={(event) => {
                    const value = event.target.value;
                    const overLimit =
                      Array.from(value.trim()).length > TEAM_NAME_MAX_LENGTH;
                    window.clearTimeout(nameWarningTimers.current[ti]);
                    setNameWarnings((current) =>
                      current[ti] === overLimit
                        ? current
                        : { ...current, [ti]: overLimit },
                    );
                    if (overLimit)
                      nameWarningTimers.current[ti] = window.setTimeout(
                        () =>
                          setNameWarnings((current) => ({
                            ...current,
                            [ti]: false,
                          })),
                        1800,
                      );
                    onTeamName(ti, normalizeTeamName(value));
                  }}
                />
                {nameWarnings[ti] && (
                  <small className="team-panel__name-warning" role="alert">
                    {getUiText(lang, "teamNameLimit", {
                      n: TEAM_NAME_MAX_LENGTH,
                    })}
                  </small>
                )}
              </label>
              <button
                type="button"
                className="team-panel__clear"
                aria-label={`${getUiText(lang, "remove")} ${ti + 1}`}
                disabled={!team.slots.some((slot) => slot.characterId)}
                onClick={() => onClearTeam(ti)}
              >
                <Trash2 size={13} />
                <span>{getUiText(lang, "remove")}</span>
              </button>
            </header>
            <div className="team-panel__slots">
              {team.slots.map((slot, si) => {
                const presentation = presentTeamSlot(
                    slot,
                    profile,
                    lang,
                    revealFuture,
                    getUiText(lang, "hiddenFutureSlot"),
                  ),
                  character = presentation.character,
                  def = character?.definition,
                  build = character?.build,
                  hidden = character?.hidden ?? false,
                  variant = character?.variant,
                  psychubeSlots = def?.psychubeSlots ?? 1,
                  target = assignment?.team === ti && assignment.slot === si;
                return (
                  <div
                    key={si}
                    className={cx(
                      "team-slot",
                      !def && "team-slot--empty",
                      target && "team-slot--target",
                      hidden && "team-slot--hidden",
                    )}
                  >
                    <button
                      type="button"
                      className="team-slot__character"
                      aria-label={getUiText(lang, "slotN", { n: si + 1 })}
                      onClick={() => onSlotClick(ti, si, "character")}
                    >
                      <span className="team-slot__avatar">
                        <span className="team-slot__pos">{si + 1}</span>
                        {def && build && variant && !hidden ? (
                          <>
                            <AssetIcon
                              kind="character"
                              id={variant.id}
                              alt={character!.name}
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
                          {def && !hidden
                            ? character!.name
                            : hidden
                              ? getUiText(lang, "hiddenFutureSlot")
                              : ""}
                        </span>
                        {def && build && !hidden && (
                          <span className="team-slot__meta">
                            <InsightGlyph insight={build.insight} />
                            <span>Lv.{build.level}</span>
                            <span
                              className="resonance-stat"
                              aria-label={`${getUiText(lang, "resonance")} ${build.resonance}`}
                            >
                              <ResonanceIcon size={14} aria-hidden="true" />
                              {build.resonance}
                            </span>
                          </span>
                        )}
                      </span>
                    </button>
                    {def && (
                      <button
                        type="button"
                        className="remove-icon-btn team-slot__clear-slot"
                        aria-label={getUiText(lang, "clearSlotLabel", {
                          team: ti + 1,
                          slot: si + 1,
                        })}
                        onClick={() => onClearSlot(ti, si)}
                      >
                        <X size={12} />
                      </button>
                    )}
                    {def && build && !hidden && (
                      <div className="team-slot__psychubes">
                        {presentation.psychubes
                          .slice(0, psychubeSlots)
                          .map((psychube, psychubeIndex) => {
                            const psy = psychube?.definition,
                              psyHidden = psychube?.hidden ?? false;
                            return (
                              <button
                                key={psychubeIndex}
                                type="button"
                                className={cx(
                                  "team-slot__psy",
                                  !psy && "team-slot__psy--empty",
                                  psyHidden && "team-slot__psy--hidden",
                                )}
                                aria-label={
                                  psy && !psyHidden
                                    ? `${psychube!.name} · ${getUiText(lang, "psychubeImprint")} ${psychube!.amplification}`
                                    : getUiText(lang, "emptyPsychube")
                                }
                                onClick={() =>
                                  onSlotClick(
                                    ti,
                                    si,
                                    "psychube",
                                    psychubeIndex as 0 | 1,
                                  )
                                }
                              >
                                {psy && !psyHidden ? (
                                  <>
                                    <AssetIcon
                                      kind="psychube"
                                      id={psy.id}
                                      alt={psychube!.name}
                                    />
                                    <PsychubeAmplificationBadge
                                      value={psychube!.amplification}
                                    />
                                  </>
                                ) : psyHidden ? (
                                  "?"
                                ) : (
                                  "＋"
                                )}
                              </button>
                            );
                          })}
                      </div>
                    )}
                    {!!slot.characterId && (
                      <div className="team-slot__swap">
                        {si > 0 && (
                          <button
                            type="button"
                            aria-label={getUiText(lang, "moveLeft")}
                            onClick={() => onSwap(ti, si, si - 1)}
                          >
                            <ChevronLeft size={13} />
                          </button>
                        )}
                        {si < 3 && (
                          <button
                            type="button"
                            aria-label={getUiText(lang, "moveRight")}
                            onClick={() => onSwap(ti, si, si + 1)}
                          >
                            <ChevronRight size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </section>
  );
}
