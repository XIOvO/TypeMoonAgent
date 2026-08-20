import type { BattleState, GameState, PlayerAction } from "./contracts.js";
import type { ProposedEvent } from "../protocol/command.js";

/** Feature-owned rules propose the next battle state; Runtime validates and commits it. */
export type CombatActionResolution =
  | { accepted: true; battle: BattleState; events: readonly ProposedEvent[] }
  | { accepted: false; reason: string };

/** Kernel port for a combat provider without embedding any battle rule implementation. */
export interface CombatActionHandler {
  resolve(input: { state: Readonly<GameState>; action: PlayerAction }): CombatActionResolution;
}
