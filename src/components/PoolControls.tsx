import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { LangCode } from "../i18n/ui";
import { getUiText } from "../i18n/ui";
import {
  type AddDefaults,
  type FilterMode,
  type PoolDefaultsDraft,
  type PoolTab,
  type PsychubeOwnershipMode,
} from "../utils/pool-model";
import type { DefaultSkinMode } from "../types/profile";
import { InsightGlyph } from "./InsightGlyph";
import { Btn, SegButtons, Stepper } from "../utils/design";

export function PoolControls({
  lang,
  tab,
  search,
  filterMode,
  rarityFilter,
  addDefaults,
  defaultSkinMode,
  psychubeImprintDefault,
  psychubeOwnershipStatus,
  rarityOptions,
  onTab,
  onSearch,
  onFilter,
  onRarity,
  onDefaults,
  onDefaultSkinMode,
  onPsychubeImprintDefault,
  onSetAllPsychubesOwned,
}: {
  lang: LangCode;
  tab: "characters" | "psychubes";
  search: string;
  filterMode: FilterMode;
  rarityFilter: number[];
  addDefaults: AddDefaults;
  defaultSkinMode: DefaultSkinMode;
  psychubeImprintDefault: number;
  psychubeOwnershipStatus: PsychubeOwnershipMode | null;
  rarityOptions: readonly number[];
  onTab: (tab: PoolTab) => void;
  onSearch: (value: string) => void;
  onFilter: (value: FilterMode) => void;
  onRarity: (value: number[]) => void;
  onDefaults: (value: Partial<AddDefaults>) => void;
  onDefaultSkinMode: (value: DefaultSkinMode) => void;
  onPsychubeImprintDefault: (value: number) => void;
  onSetAllPsychubesOwned: (owned: boolean, imprint: number) => void;
}): React.JSX.Element {
  const t = (key: string, params?: Record<string, string | number>) =>
    getUiText(lang, key, params);
  const [draft, setDraft] = useState<PoolDefaultsDraft | null>(null);
  const defaultsOpen = draft !== null;
  const defaultsRef = useRef<HTMLDivElement>(null);
  const beginDefaults = () => {
    setDraft({
      addDefaults: { ...addDefaults },
      defaultSkinMode,
      psychubeAmplificationDefault: psychubeImprintDefault,
      psychubeOwnershipStatus,
    });
  };
  const cancelDefaults = () => {
    setDraft(null);
  };
  const completeDefaults = () => {
    if (!draft) return;
    if (tab === "characters") {
      onDefaults({ ...draft.addDefaults });
      onDefaultSkinMode(draft.defaultSkinMode);
    } else {
      onPsychubeImprintDefault(draft.psychubeAmplificationDefault);
      if (draft.psychubeOwnershipStatus)
        onSetAllPsychubesOwned(
          draft.psychubeOwnershipStatus === "owned",
          draft.psychubeAmplificationDefault,
        );
    }
    setDraft(null);
  };
  useEffect(() => setDraft(null), [tab]);
  useEffect(() => {
    if (!defaultsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!defaultsRef.current?.contains(event.target as Node))
        cancelDefaults();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [defaultsOpen]);
  const draftState: PoolDefaultsDraft = draft ?? {
    addDefaults: { ...addDefaults },
    defaultSkinMode,
    psychubeAmplificationDefault: psychubeImprintDefault,
    psychubeOwnershipStatus,
  };
  const updateAddDefaults = (patch: Partial<AddDefaults>): void => {
    setDraft((current) =>
      current
        ? { ...current, addDefaults: { ...current.addDefaults, ...patch } }
        : current,
    );
  };
  const updateDraft = (patch: Partial<PoolDefaultsDraft>): void => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };
  return (
    <div className="pool-controls">
      <div className="ds-seg" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "characters"}
          className={`ds-seg__item ${tab === "characters" ? "is-selected" : ""}`}
          onClick={() => onTab("characters")}
        >
          {t("tabCharacters")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "psychubes"}
          className={`ds-seg__item ${tab === "psychubes" ? "is-selected" : ""}`}
          onClick={() => onTab("psychubes")}
        >
          {t("tabPsychubes")}
        </button>
      </div>
      <label className="pool-search">
        <Search size={14} />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
        />
      </label>
      <div className="ds-seg" role="group">
        {(["all", "owned", "unowned"] as FilterMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`ds-seg__item ${filterMode === mode ? "is-selected" : ""}`}
            aria-pressed={filterMode === mode}
            onClick={() => onFilter(mode)}
          >
            {t(
              mode === "all"
                ? "filterAll"
                : mode === "owned"
                  ? "filterOwned"
                  : "filterUnowned",
            )}
          </button>
        ))}
      </div>
      <div className="rarity-filter" role="group" aria-label={t("rarity")}>
        {rarityOptions.map((rarity) => (
          <button
            key={rarity}
            type="button"
            aria-pressed={rarityFilter.includes(rarity)}
            data-active={rarityFilter.includes(rarity)}
            onClick={() =>
              onRarity(
                rarityFilter.includes(rarity)
                  ? rarityFilter.filter((x) => x !== rarity)
                  : [...rarityFilter, rarity],
              )
            }
          >
            ★{rarity}
          </button>
        ))}
      </div>
      <div className="add-defaults" ref={defaultsRef}>
        <button
          type="button"
          className="add-defaults__toggle"
          aria-expanded={defaultsOpen}
          onClick={() => (defaultsOpen ? cancelDefaults() : beginDefaults())}
        >
          {t("addDefaults")}
        </button>
        {defaultsOpen && (
          <div className="add-defaults__panel">
            {tab === "characters" ? (
              <div className="editor-modules add-defaults__modules">
                <section className="editor-section">
                  <header className="editor-section__head">
                    <span>{t("level")}</span>
                    <output>Lv.{draftState.addDefaults.level} / 60</output>
                  </header>
                  <div className="editor-section__controls">
                    <Stepper
                      label={t("level")}
                      value={draftState.addDefaults.level}
                      min={1}
                      max={60}
                      onChange={(level) => updateAddDefaults({ level })}
                      decreaseLabel={t("decreaseValue", { name: t("level") })}
                      increaseLabel={t("increaseValue", { name: t("level") })}
                    />
                    <SegButtons
                      options={[1, 20, 30, 40, 50, 60].map((value) => ({
                        key: String(value),
                        label: value === 60 ? t("max") : String(value),
                      }))}
                      selected={String(draftState.addDefaults.level)}
                      onSelect={(value) =>
                        updateAddDefaults({ level: Number(value) })
                      }
                    />
                  </div>
                </section>
                <section className="editor-section editor-section--insight">
                  <header className="editor-section__head">
                    <span>{t("insight")}</span>
                    <output
                      className="editor-section__current"
                      aria-label={`${t("insight")} ${draftState.addDefaults.insight}`}
                    >
                      <InsightGlyph insight={draftState.addDefaults.insight} />
                    </output>
                  </header>
                  <div className="editor-section__controls">
                    <SegButtons
                      options={[0, 1, 2, 3].map((value) => ({
                        key: String(value),
                        label: <InsightGlyph insight={value} />,
                        ariaLabel: `${t("insight")} ${value}`,
                      }))}
                      className="insight-selector"
                      selected={String(draftState.addDefaults.insight)}
                      onSelect={(value) =>
                        updateAddDefaults({
                          insight: Number(value) as 0 | 1 | 2 | 3,
                        })
                      }
                    />
                  </div>
                </section>
                <section className="editor-section">
                  <header className="editor-section__head">
                    <span>{t("resonance")}</span>
                    <output>{draftState.addDefaults.resonance}</output>
                  </header>
                  <div className="editor-section__controls">
                    <Stepper
                      label={t("resonance")}
                      value={draftState.addDefaults.resonance}
                      min={0}
                      max={15}
                      onChange={(resonance) => updateAddDefaults({ resonance })}
                      decreaseLabel={t("decreaseValue", {
                        name: t("resonance"),
                      })}
                      increaseLabel={t("increaseValue", {
                        name: t("resonance"),
                      })}
                    />
                    <SegButtons
                      options={[1, 10, 15].map((value) => ({
                        key: String(value),
                        label: String(value),
                      }))}
                      selected={
                        [1, 10, 15].includes(draftState.addDefaults.resonance)
                          ? String(draftState.addDefaults.resonance)
                          : undefined
                      }
                      onSelect={(value) =>
                        updateAddDefaults({ resonance: Number(value) })
                      }
                    />
                  </div>
                </section>
                <section className="editor-section">
                  <header className="editor-section__head">
                    <span>{t("portray")}</span>
                  </header>
                  <div className="editor-section__controls">
                    <SegButtons
                      options={[0, 1, 2, 3, 4, 5].map((value) => ({
                        key: String(value),
                        label: String(value),
                      }))}
                      selected={String(draftState.addDefaults.portray)}
                      onSelect={(value) =>
                        updateAddDefaults({ portray: Number(value) })
                      }
                    />
                  </div>
                </section>
                <section className="editor-section add-defaults__skin-mode">
                  <header className="editor-section__head">
                    <span>{t("defaultSkin")}</span>
                    <output>
                      {t(
                        draftState.defaultSkinMode === "initial"
                          ? "skinDefault"
                          : "skinInsight",
                      )}
                    </output>
                  </header>
                  <div className="editor-section__controls">
                    <SegButtons
                      options={[
                        { key: "initial", label: t("skinDefault") },
                        { key: "insight", label: t("skinInsight") },
                      ]}
                      selected={draftState.defaultSkinMode}
                      onSelect={(value) =>
                        updateDraft({
                          defaultSkinMode: value as DefaultSkinMode,
                        })
                      }
                    />
                  </div>
                </section>
              </div>
            ) : (
              <div className="editor-modules add-defaults__modules">
                <section className="editor-section">
                  <header className="editor-section__head">
                    <span>{t("defaultPsychubeImprint")}</span>
                    <output>{draftState.psychubeAmplificationDefault}</output>
                  </header>
                  <div className="editor-section__controls">
                    <SegButtons
                      options={[1, 2, 3, 4, 5].map((value) => ({
                        key: String(value),
                        label: String(value),
                      }))}
                      selected={String(draftState.psychubeAmplificationDefault)}
                      onSelect={(value) =>
                        updateDraft({
                          psychubeAmplificationDefault: Number(value),
                        })
                      }
                    />
                  </div>
                </section>
                <section className="editor-section">
                  <header className="editor-section__head">
                    <span>{t("defaultPsychubeOwnership")}</span>
                  </header>
                  <div className="editor-section__controls">
                    <SegButtons
                      options={[
                        {
                          key: "unowned",
                          label: t("allPsychubesUnowned"),
                        },
                        { key: "owned", label: t("allPsychubesOwned") },
                      ]}
                      selected={draftState.psychubeOwnershipStatus ?? undefined}
                      onSelect={(value) =>
                        updateDraft({
                          psychubeOwnershipStatus: value as PsychubeOwnershipMode,
                        })
                      }
                    />
                  </div>
                </section>
              </div>
            )}
            <div className="editor-actions add-defaults__actions">
              <Btn variant="neutral" onClick={cancelDefaults}>
                {t("cancel")}
              </Btn>
              <Btn variant="primary" onClick={completeDefaults}>
                {t("done")}
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
