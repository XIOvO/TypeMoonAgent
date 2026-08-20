/** Candidate output from an Agent. It never applies world state directly. */
export interface AgentAction {
  id: string;
  sessionId: string;
  actorId: string;
  observationId: string;
  utterance?: AgentUtterance;
  requests?: ActionRequest[];
  metadata?: AgentActionMetadata;
}

export interface AgentUtterance {
  text: string;
  emotion?: string;
  expression?: string;
  voiceStyle?: string;
  targetIds?: string[];
}

export interface AgentActionMetadata {
  provider?: string;
  model?: string;
  traceId?: string;
}

/** Generic request proposal; an authority must validate it before settlement. */
export interface ActionRequest {
  type: string;
  actorId: string;
  targetIds?: string[];
  parameters?: Record<string, unknown>;
  capabilityHint?: string;
}

/** v0.2 request shape accepted by the current Runtime. */
export interface LegacyMoveActionRequest {
  type: "move";
  actorId: string;
  destination: string;
}

/** v0.2 AgentAction compatibility shape. */
export interface LegacyAgentAction {
  id: string;
  sessionId: string;
  actorId: string;
  observationId: string;
  utterance?: string;
  requests: LegacyMoveActionRequest[];
}

export type ActionRequestAdaptation =
  | { accepted: true; request: LegacyMoveActionRequest }
  | { accepted: false; reason: "unsupported_action_request" | "invalid_move_request" };

/**
 * Narrow v0.3 proposals to the only request current Runtime can settle.
 * Unknown requests are deliberately rejected instead of becoming world writes.
 */
export function adaptLegacyActionRequest(request: ActionRequest): ActionRequestAdaptation {
  if (request.type !== "move") return { accepted: false, reason: "unsupported_action_request" };
  const destination = request.parameters?.destination;
  return typeof destination === "string"
    ? { accepted: true, request: { type: "move", actorId: request.actorId, destination } }
    : { accepted: false, reason: "invalid_move_request" };
}
