import type { GameMoment } from "./time.js";

/** Immutable v0.3 committed-event envelope. */
export interface GameEvent<T = unknown> {
  id: string;
  sessionId: string;
  type: string;
  schemaVersion: number;
  sequence: number;
  stateRevision: number;
  createdAt: string;
  moment?: GameMoment;
  source: EventSource;
  causation: EventCausation;
  correlationId: string;
  payload: T;
  metadata?: Record<string, unknown>;
}

export interface EventSource {
  pluginId?: string;
  capabilityId?: string;
  system?: string;
}

export interface EventCausation {
  playerActionId?: string;
  agentActionId?: string;
  commandId?: string;
  sourceEventId?: string;
}

/** Exact v0.2 persisted event shape; retained for existing saves and readers. */
export interface LegacyGameEvent<T = Record<string, unknown>, TType extends string = string> {
  id: string;
  sessionId: string;
  createdAt: string;
  sequence: number;
  type: TType;
  payload: T;
  causation: { playerActionId?: string; systemActionId?: string; agentActionId?: string };
  stateRevision: number;
  moment?: GameMoment;
}

/**
 * Explicit read-time upgrader. It preserves legacy payload and ordering rather
 * than rewriting stored history; migrated source/correlation are identified.
 */
export function upgradeLegacyGameEvent<T, TType extends string>(event: LegacyGameEvent<T, TType>): GameEvent<T> {
  const { systemActionId, ...causation } = event.causation;
  return {
    id: event.id, sessionId: event.sessionId, type: event.type, schemaVersion: 3,
    sequence: event.sequence, stateRevision: event.stateRevision, createdAt: event.createdAt,
    ...(event.moment ? { moment: event.moment } : {}),
    source: systemActionId ? { system: "legacy-v0.2" } : { system: "runtime" },
    causation: { ...causation, ...(systemActionId ? { commandId: systemActionId } : {}) },
    correlationId: `legacy:${event.sessionId}:${event.id}`,
    payload: event.payload,
  };
}
