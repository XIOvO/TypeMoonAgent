import type { ContextReference } from "../protocol/observation.js";

/** Safe, queryable metadata for one turn. It intentionally has no text or payload fields. */
export interface TurnTrace {
  id: string;
  sessionId: string;
  correlationId: string;
  recordedAt: string;
  playerActionId?: string;
  observationId?: string;
  agentActionId?: string;
  commandIds: readonly string[];
  eventIds: readonly string[];
  provider?: { id: string; model?: string };
  contextRefs: readonly TurnTraceContextReference[];
  durationMs?: number;
  outcome?: "succeeded" | "rejected" | "failed";
  errorCode?: string;
}

/** Context provenance is traceable without copying private context summaries. */
export interface TurnTraceContextReference {
  type: ContextReference["type"];
  id: string;
}

export interface TurnTraceInput {
  id: string;
  sessionId: string;
  correlationId: string;
  recordedAt: string;
  playerActionId?: string;
  observationId?: string;
  agentActionId?: string;
  commandIds?: readonly string[];
  eventIds?: readonly string[];
  provider?: { id: string; model?: string };
  contextRefs?: readonly Pick<ContextReference, "type" | "id">[];
  durationMs?: number;
  outcome?: TurnTrace["outcome"];
  errorCode?: string;
}

export interface TurnTraceStore {
  record(input: TurnTraceInput): TurnTrace;
  list(sessionId: string, correlationId?: string): readonly TurnTrace[];
}

/** In-memory adapter for tests and early runtime wiring; persistence remains feature-owned. */
export class InMemoryTurnTraceStore implements TurnTraceStore {
  private readonly traces: TurnTrace[] = [];

  public record(input: TurnTraceInput): TurnTrace {
    const trace = toTurnTrace(input);
    this.traces.push(trace);
    return clone(trace);
  }

  public list(sessionId: string, correlationId?: string): readonly TurnTrace[] {
    return this.traces
      .filter((trace) => trace.sessionId === sessionId && (correlationId === undefined || trace.correlationId === correlationId))
      .map(clone);
  }
}

export function toTurnTrace(input: TurnTraceInput): TurnTrace {
  required(input.id, "turn_trace_id_required");
  required(input.sessionId, "turn_trace_session_required");
  required(input.correlationId, "turn_trace_correlation_required");
  required(input.recordedAt, "turn_trace_recorded_at_required");
  if (input.durationMs !== undefined && (!Number.isFinite(input.durationMs) || input.durationMs < 0)) throw new Error("turn_trace_duration_invalid");
  return {
    id: input.id, sessionId: input.sessionId, correlationId: input.correlationId, recordedAt: input.recordedAt,
    ...(input.playerActionId ? { playerActionId: input.playerActionId } : {}),
    ...(input.observationId ? { observationId: input.observationId } : {}),
    ...(input.agentActionId ? { agentActionId: input.agentActionId } : {}),
    commandIds: [...(input.commandIds ?? [])], eventIds: [...(input.eventIds ?? [])],
    ...(input.provider ? { provider: { id: input.provider.id, ...(input.provider.model ? { model: input.provider.model } : {}) } } : {}),
    contextRefs: (input.contextRefs ?? []).map(({ type, id }) => ({ type, id })),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };
}

function required(value: string, error: string): void { if (!value.trim()) throw new Error(error); }
function clone(trace: TurnTrace): TurnTrace { return structuredClone(trace); }
