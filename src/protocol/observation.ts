import type { GameMoment } from "./time.js";

/** Runtime-authorized, recipient-specific view; never a complete game state. */
export interface Observation<TSelfState = unknown> {
  id: string;
  sessionId: string;
  recipientId: string;
  triggerActionId?: string;
  scene: SceneObservation;
  incomingAction?: VisibleIncomingAction;
  selfState?: TSelfState;
  participants?: VisibleEntity[];
  constraints: ObservationConstraints;
  contextRefs?: ContextReference[];
  moment?: GameMoment;
}

export interface SceneObservation {
  locationId?: string;
  description?: string;
  visibleEntityIds?: string[];
  visibleObjectIds?: string[];
  tags?: string[];
}

export interface VisibleIncomingAction {
  actorId: string;
  type: string;
  content?: string;
  parameters?: Record<string, unknown>;
}

export interface VisibleEntity {
  id: string;
  label?: string;
  tags?: string[];
}

export interface ObservationConstraints {
  allowedActionTypes?: string[];
  forbiddenActionTypes?: string[];
  maxTargets?: number;
  toolPolicy?: string[];
  domain?: string;
}

export interface ContextReference {
  type: "identity" | "memory" | "knowledge" | "belief" | "relationship" | "lore";
  id: string;
  summary?: string;
}

/**
 * v0.2 compatibility view. Its legacy `scene.id` and string constraints are
 * intentionally separate so consumers can upgrade without a silent reshape.
 */
export interface LegacyObservation<TSelfState = unknown> {
  id: string;
  sessionId: string;
  recipientId: string;
  triggerActionId: string;
  scene: { id: string; visibleEntityIds: string[] };
  incomingAction: VisibleIncomingAction;
  selfState: TSelfState;
  constraints: string[];
}
