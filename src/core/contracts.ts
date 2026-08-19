/** Core game protocol: the three player-facing lanes remain unified in GameRuntime. */
export type ActionType = "dialogue" | "action" | "combat";

/**
 * `parameters.intent` on a PlayerAction is deliberately a string rather than
 * an enum. It is an optional routing hint, not a closed catalogue of what a
 * player is allowed to attempt. The Runtime only settles intents for which it
 * owns an explicit rule.
 */
export type BuiltinWorldActionIntent = "move" | "observe" | "wait" | "inspect" | "interact";

/** Small, extensible vocabulary for the first deterministic combat resolver. */
export type CombatActionKind = "attack" | "defend" | "skill" | "item" | "retreat" | "analyze";
export type BattleParticipation = "command" | "delegate" | "quick_resolve";

/** A proposed intent, never an assertion that its result has happened. */
export interface BattleCommand {
  actorId?: string;
  intent: CombatActionKind;
  targetId?: string;
}

/**
 * The player chooses a participation style; Runtime owns validation and
 * settlement. More detailed FGO-style commands can be added without changing
 * the PlayerAction boundary.
 */
export interface BattleDirective {
  participation: BattleParticipation;
  commands?: BattleCommand[];
  delegateTo?: string[];
}

export type EventType =
  | "player_spoke"
  | "character_spoke"
  | "character_moved"
  | "area_observed"
  | "object_inspected"
  | "object_interacted"
  | "time_waited"
  | "battle_started"
  | "battle_round_resolved"
  | "battle_finished"
  | "character_introduced"
  | "chapter_entered"
  | "story_summon_opened"
  | "action_rejected";

/**
 * Authoritative narrative time. It is independent from wall-clock timestamps,
 * which remain operational metadata for persistence and worker leases.
 */
export interface GameMoment {
  timelineId: string;
  tick: number;
  /** Optional game-owned display/calendar data; Runtime does not calculate it. */
  calendar?: Record<string, string | number | boolean>;
}

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
  /** `auto` must be handled by an interpreter; it is never silently treated as dialogue. */
  mode: ActionType | "auto";
  parameters?: Record<string, unknown>;
}

export type ParsedPlayerIntent =
  | { kind: "resolved"; action: PlayerAction; privateThought?: string }
  | { kind: "needs_interpreter"; reason: "ambiguous_freeform_input" };

export interface Observation {
  id: string;
  sessionId: string;
  recipientId: string;
  triggerActionId: string;
  scene: { id: string; visibleEntityIds: string[] };
  incomingAction: Pick<PlayerAction, "actorId" | "type" | "content" | "parameters">;
  selfState: CharacterState;
  constraints: string[];
}

export interface AgentAction {
  id: string;
  sessionId: string;
  actorId: string;
  observationId: string;
  utterance?: string;
  requests: ActionRequest[];
}

/** One-call proposal: player intent remains a candidate until Runtime settles it. */
export interface CombinedTurnProposal {
  player: {
    type: ActionType;
    publicText?: string;
    targetIds?: string[];
    parameters?: Record<string, unknown>;
    privateThought?: string;
  };
  /** Required by Runtime only while the objective world has an active battle. */
  battle?: BattleDirective;
  character: AgentAction;
}

export interface ActionRequest {
  type: "move";
  actorId: string;
  destination: string;
}

export interface GameEvent {
  id: string;
  sessionId: string;
  createdAt: string;
  sequence: number;
  type: EventType;
  payload: Record<string, unknown>;
  causation: { playerActionId?: string; systemActionId?: string; agentActionId?: string };
  stateRevision: number;
  /** Missing only on events written before the game-time migration. */
  moment?: GameMoment;
}

export interface CharacterState {
  id: string;
  locationId: string;
  mood: "calm" | "alert";
}

export interface GameState {
  sessionId: string;
  revision: number;
  /** Missing only on old saves; Runtime initializes it as `session:<id>`, tick 0. */
  moment?: GameMoment;
  characters: Record<string, CharacterState>;
  locations: Record<string, { id: string; exits: string[] }>;
  /** Optional during migration; all new scenes should provide an object map. */
  objects?: Record<string, SceneObject>;
  /** Absent outside combat. This is objective Runtime state, not prompt text. */
  battle?: BattleState;
}

export interface BattleCombatant {
  id: string;
  hp: number;
  maxHp: number;
  states: string[];
}

export interface BattleState {
  id: string;
  locationId: string;
  status: "active" | "resolved";
  turn: number;
  objective: string;
  outcome?: "victory" | "withdrawn";
  allies: Record<string, BattleCombatant>;
  enemies: Record<string, BattleCombatant>;
}

/** Trusted story/GM request. A player action cannot create a battle. */
export interface RuntimeBattleStartRequest {
  id: string;
  sessionId: string;
  locationId: string;
  objective: string;
  allies: BattleCombatant[];
  enemies: BattleCombatant[];
}

/** Scene data, not a list of hard-coded player actions. */
export interface SceneObject {
  id: string;
  kind: "door" | "device" | "container" | "document" | "landmark" | "generic";
  locationId: string;
  visible: boolean;
  tags: string[];
  inspectText?: string;
  state?: Record<string, "open" | "closed" | "locked" | "active" | "inactive" | boolean | string>;
}

export interface ActionResult {
  actionId: string;
  events: GameEvent[];
  stateRevision: number;
}

/** Player-only material: never part of a GameEvent or NPC Observation. */
export interface PlayerPrivateNote {
  id: string;
  sessionId: string;
  playerId: string;
  sourceInputId: string;
  content: string;
  createdAt: string;
}

/** Trusted story/GM request. This is intentionally not a PlayerAction. */
export interface RuntimeCharacterIntroductionRequest {
  id: string;
  sessionId: string;
  characterId: string;
  locationId: string;
  reason: "story_trigger" | "summon" | "encounter" | "gm_request";
  mood?: CharacterState["mood"];
}
