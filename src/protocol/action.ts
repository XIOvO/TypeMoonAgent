/**
 * Public action contracts. These describe requests and their settlement
 * result without depending on any Runtime event implementation.
 */
export type ActionType = "dialogue" | "action" | "combat";

/**
 * `parameters.intent` is an optional routing hint, not a closed catalogue of
 * actions a player may attempt. Runtime remains responsible for settlement.
 */
export type BuiltinWorldActionIntent = "move" | "observe" | "wait" | "inspect" | "interact";

/** A proposed intent, never an assertion that it happened in the world. */
export interface PlayerAction {
  id: string;
  sessionId: string;
  actorId: string;
  type: ActionType;
  content?: string;
  targetIds?: string[];
  parameters?: Record<string, unknown>;
}

/** Raw player text is not itself a claim about what became true in the world. */
export interface RawPlayerInput {
  id: string;
  sessionId: string;
  actorId: string;
  content: string;
  targetIds?: string[];
  /** `auto` must be handled by an interpreter; it is never silently dialogue. */
  mode: ActionType | "auto";
  parameters?: Record<string, unknown>;
}

export type ParsedPlayerIntent =
  | { kind: "resolved"; action: PlayerAction; privateThought?: string }
  | { kind: "needs_interpreter"; reason: "ambiguous_freeform_input" };

/**
 * The protocol is event-model agnostic. A host can bind TEvent to its event
 * envelope while preserving the serializable action-result shape.
 */
export interface ActionResult<TEvent = unknown> {
  actionId: string;
  events: TEvent[];
  stateRevision: number;
}
