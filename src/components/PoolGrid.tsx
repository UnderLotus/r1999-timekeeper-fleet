import type { LangCode } from "../i18n/ui";
import { getUiText } from "../i18n/ui";
import type { CharacterBuild } from "../types/profile";
import type { InsightIndex } from "../types/catalog";
import {
  allCharacters,
  psychubesByRarityAndRecency,
  searchableNames,
} from "../utils/catalog";
import type { AnchorRect } from "../utils/design";
import { CharacterCard } from "./CharacterCard";
import { PsychubeCard } from "./PsychubeCard";
import type { Assignment, FilterMode } from "../store/boxStore";
export function PoolGrid({
  tab,
  lang,
  revealFuture,
  ownedCharacters,
  psychubes,
  search,
  filterMode,
  rarityFilter,
  assignment,
  onAddCharacter,
  onOpenEditor,
  onOpenSkin,
  onRemoveCharacter,
  onSetInsight,
  onSetResonance,
  onPickCharacter,
  onPickPsychube,
  onSetPsychubeImprint,
  onRemovePsychube,
  onAddPsychube,
}: {
  tab: "characters" | "psychubes";
  lang: LangCode;
  revealFuture: boolean;
  ownedCharacters: Record<string, CharacterBuild>;
  psychubes: Record<string, number>;
  search: string;
  filterMode: FilterMode;
  rarityFilter: number[];
  assignment: Assignment | null;
  onAddCharacter: (id: string) => void;
  onOpenEditor: (
    id: string,
    field: "all" | "level" | "resonance",
    anchor: AnchorRect,
  ) => void;
  onOpenSkin: (id: string, anchor: AnchorRect) => void;
  onRemoveCharacter: (id: string) => void;
  onSetInsight: (id: string, value: InsightIndex) => void;
  onSetResonance: (id: string, value: number) => void;
  onPickCharacter: (id: string) => void;
  onPickPsychube: (id: string) => void;
  onSetPsychubeImprint: (id: string, value: number) => void;
  onRemovePsychube: (id: string) => void;
  onAddPsychube: (id: string) => void;
}): React.JSX.Element {
  const q = search.trim().toLocaleLowerCase();
  if (tab === "psychubes") {
    const applicableRarityFilter = rarityFilter.filter((rarity) => rarity >= 3);
    const list = psychubesByRarityAndRecency()
      .filter((item) => item.released || revealFuture)
      .filter((item) => {
        const owned = !!psychubes[item.id];
        if (filterMode === "owned" && !owned) return false;
        if (filterMode === "unowned" && owned) return false;
        if (
          applicableRarityFilter.length &&
          item.rarity !== null &&
          !applicableRarityFilter.includes(item.rarity + 1)
        )
          return false;
        return !q || searchableNames(item.names).includes(q);
      });
    return (
      <div className="pool-grid">
        {!list.length && (
          <div className="pool-empty">
            {getUiText(lang, "noResultPsychube")}
          </div>
        )}
        {list.map((item) => {
          const imprint = psychubes[item.id] ?? 0,
            owned = imprint > 0;
          return (
            <PsychubeCard
              key={item.id}
              def={item}
              imprint={imprint}
              lang={lang}
              onAdd={() => onAddPsychube(item.id)}
              onSetImprint={(value) => onSetPsychubeImprint(item.id, value)}
              onRemove={() => onRemovePsychube(item.id)}
              onAssign={
                assignment?.kind === "psychube" && owned
                  ? () => onPickPsychube(item.id)
                  : undefined
              }
            />
          );
        })}
      </div>
    );
  }
  const list = allCharacters()
    .filter((item) => item.released || revealFuture)
    .filter((item) => {
      const owned = !!ownedCharacters[item.id];
      if (filterMode === "owned" && !owned) return false;
      if (filterMode === "unowned" && owned) return false;
      const rarity = item.rarity === null ? null : item.rarity + 1;
      if (
        rarityFilter.length &&
        rarity !== null &&
        !rarityFilter.includes(rarity)
      )
        return false;
      return !q || searchableNames(item.names).includes(q);
    });
  return (
    <div className="pool-grid">
      {!list.length && (
        <div className="pool-empty">{getUiText(lang, "noResult")}</div>
      )}
      {list.map((def) => (
        <CharacterCard
          key={def.id}
          def={def}
          build={ownedCharacters[def.id]}
          lang={lang}
          revealFuture={revealFuture}
          onAdd={() => onAddCharacter(def.id)}
          onOpenEditor={(field, anchor) => onOpenEditor(def.id, field, anchor)}
          onOpenSkin={(anchor) => onOpenSkin(def.id, anchor)}
          onRemove={() => onRemoveCharacter(def.id)}
          onSetInsight={(value) => onSetInsight(def.id, value)}
          onSetResonance={(value) => onSetResonance(def.id, value)}
          onAssign={
            assignment?.kind === "character" && ownedCharacters[def.id]
              ? () => onPickCharacter(def.id)
              : undefined
          }
        />
      ))}
    </div>
  );
}
