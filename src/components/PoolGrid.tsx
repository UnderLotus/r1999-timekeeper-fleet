import type { LangCode } from "../i18n/ui";
import { getUiText } from "../i18n/ui";
import type { InsightIndex } from "../types/catalog";
import type { AnchorRect } from "../utils/design";
import type { Assignment, PoolView } from "../utils/pool-model";
import { CharacterCard } from "./CharacterCard";
import { PsychubeCard } from "./PsychubeCard";

export function PoolGrid({
  view,
  lang,
  revealFuture,
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
  view: PoolView;
  lang: LangCode;
  revealFuture: boolean;
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
  if (view.tab === "psychubes") {
    return (
      <div className="pool-grid">
        {!view.psychubes.length && (
          <div className="pool-empty">
            {getUiText(lang, "noResultPsychube")}
          </div>
        )}
        {view.psychubes.map(({ definition, amplification, owned }) => (
          <PsychubeCard
            key={definition.id}
            def={definition}
            imprint={amplification}
            lang={lang}
            onAdd={() => onAddPsychube(definition.id)}
            onSetImprint={(value) =>
              onSetPsychubeImprint(definition.id, value)
            }
            onRemove={() => onRemovePsychube(definition.id)}
            onAssign={
              assignment?.kind === "psychube" && owned
                ? () => onPickPsychube(definition.id)
                : undefined
            }
          />
        ))}
      </div>
    );
  }

  return (
    <div className="pool-grid">
      {!view.characters.length && (
        <div className="pool-empty">{getUiText(lang, "noResult")}</div>
      )}
      {view.characters.map(({ definition, build, owned }) => (
        <CharacterCard
          key={definition.id}
          def={definition}
          build={build}
          lang={lang}
          revealFuture={revealFuture}
          onAdd={() => onAddCharacter(definition.id)}
          onOpenEditor={(field, anchor) =>
            onOpenEditor(definition.id, field, anchor)
          }
          onOpenSkin={(anchor) => onOpenSkin(definition.id, anchor)}
          onRemove={() => onRemoveCharacter(definition.id)}
          onSetInsight={(value) => onSetInsight(definition.id, value)}
          onSetResonance={(value) => onSetResonance(definition.id, value)}
          onAssign={
            assignment?.kind === "character" && owned
              ? () => onPickCharacter(definition.id)
              : undefined
          }
        />
      ))}
    </div>
  );
}
