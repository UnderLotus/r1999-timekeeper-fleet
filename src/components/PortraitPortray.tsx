import type { CharacterBuild } from "../types/profile";
import { PortrayBadge } from "./PortrayBadge";

/** 角色 Pool 頭像內只保留塑造；等級改在名稱下方獨立顯示。 */
export function PortraitPortray({
  build,
}: {
  build: CharacterBuild;
}): React.JSX.Element {
  return (
    <div className="portrait-portray" aria-label={`P${build.portray}`}>
      <PortrayBadge
        portray={build.portray}
        className="portrait-portray__badge"
      />
    </div>
  );
}
