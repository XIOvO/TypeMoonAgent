import type { GameMoment } from "../protocol/time.js";
import type {
  ActionResult as ProtocolActionResult,
  ActionType,
  BuiltinWorldActionIntent,
  ParsedPlayerIntent,
  PlayerAction,
  RawPlayerInput,
} from "../protocol/action.js";
import type { LegacyObservation } from "../protocol/observation.js";
import type { LegacyAgentAction, LegacyMoveActionRequest } from "../protocol/agent-action.js";
import type { LegacyGameEvent } from "../protocol/event.js";
import type { LegacyGameState } from "../protocol/state.js";

export type { GameMoment } from "../protocol/time.js";
export type {
  ActionType,
  BuiltinWorldActionIntent,
  ParsedPlayerIntent,
  PlayerAction,
  RawPlayerInput,
} from "../protocol/action.js";
export type {
  ContextReference,
  Observation as ProtocolObservation,
  ObservationConstraints,
  SceneObservation,
  VisibleEntity,
  VisibleIncomingAction,
} from "../protocol/observation.js";
export type {
  ActionRequest as ProtocolActionRequest,
  ActionRequestAdaptation,
  AgentAction as ProtocolAgentAction,
  AgentActionMetadata,
  AgentUtterance,
} from "../protocol/agent-action.js";
export type {
  CommandCausation,
  CommandEnvelope,
  CommandRejection,
  CommandResult,
  ProposedEvent,
  ProposedJob,
  StateMutationProposal,
} from "../protocol/command.js";
export type { EventCausation, EventSource, GameEvent as ProtocolGameEvent } from "../protocol/event.js";
export type { State as ProtocolState } from "../protocol/state.js";

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

/** Compatibility binding for consumers of the v0.2 Observation shape. */
export type Observation = LegacyObservation<CharacterState>;

/** Compatibility binding for the v0.2 Agent output accepted by Runtime. */
export type AgentAction = LegacyAgentAction;

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

/** Compatibility binding for the v0.2 move request accepted by Runtime. */
export type ActionRequest = LegacyMoveActionRequest;

/** Compatibility binding for the v0.2 persisted event shape. */
export type GameEvent = LegacyGameEvent<Record<string, unknown>, EventType>;

export interface CharacterState {
  id: string;
  locationId: string;
  mood: "calm" | "alert";
}

/** Compatibility binding for the current combined world and battle state. */
export type GameState = LegacyGameState<
  CharacterState,
  { id: string; exits: string[] },
  SceneObject,
  BattleState
>;

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

/** Compatibility binding for the v0.2 Runtime event representation. */
export type ActionResult = ProtocolActionResult<GameEvent>;

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
