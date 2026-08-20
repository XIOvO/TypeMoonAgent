import type { GameState, PlayerAction } from "./contracts.js";

export interface InteractionDialogueCommand {
  action: PlayerAction;
  targetId: string;
  sceneId: string;
  createdAt: string;
}

/** Capability boundary for preparing an ordinary player dialogue turn. */
export interface InteractionCommandHandler {
  resolveTarget(input: { state: Readonly<GameState>; action: PlayerAction; requestedTargetId?: string }): string | undefined;
  /** Omit this in a compatibility adapter that only resolves a target. */
  createExecutionCommitEffect?(input: InteractionDialogueCommand): () => void;
}
