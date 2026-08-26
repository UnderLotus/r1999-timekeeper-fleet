import type { LangCode } from "../i18n/ui";
import type { Profile } from "./profile";

export type ExportMode = "teams" | "pool" | "both";
export type ExportPhase = "loading" | "rendering";

export interface ExportProgress {
  phase: ExportPhase;
  loaded: number;
  total: number;
}

export interface ExportSnapshot {
  profile: Profile;
  lang: LangCode;
  mode: ExportMode;
  revealFuture: boolean;
}
