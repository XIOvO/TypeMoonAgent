import type { GameMoment } from "./time.js";

/** Generic authoritative state root; domain-specific slices live outside protocol. */
export interface State<TDomains extends Record<string, unknown> = Record<string, unknown>> {
  sessionId: string;
  revision: number;
  moment?: GameMoment;
  domains: TDomains;
}

/** v0.2 root shape retained while game and battle slices are still co-located. */
export interface LegacyGameState<TCharacter, TLocation, TObject = unknown, TBattle = unknown> {
  sessionId: string;
  revision: number;
  moment?: GameMoment;
  characters: Record<string, TCharacter>;
  locations: Record<string, TLocation>;
  objects?: Record<string, TObject>;
  battle?: TBattle;
}
