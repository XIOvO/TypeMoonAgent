import type { GameEvent } from "../core/contracts.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

/** Receives only Runtime-confirmed events. It never asks an LLM to infer facts. */
export interface CifFeedbackSink {
  record(event: GameEvent, recipientIds: readonly string[]): void;
}

/**
 * Hot-path CIF feedback: append objective history, then grant each recipient a
 * separate evidence record. An event being true does not make it known to all.
 */
export class SqliteCifFeedbackSink implements CifFeedbackSink {
  public constructor(private readonly repository: SqliteCifRepository) {}

  public record(event: GameEvent, recipientIds: readonly string[]): void {
    this.repository.appendObjectiveHistory({
      id: event.id, sessionId: event.sessionId, sequence: event.sequence,
      eventType: event.type, payload: event.payload, createdAt: event.createdAt,
    });
    for (const characterId of new Set(recipientIds)) {
      this.repository.saveEvidence({
        id: `${event.id}:${characterId}`, sessionId: event.sessionId, characterId,
        kind: "observation", content: describeEvidence(event), sourceEventIds: [event.id],
        reliability: 1, importance: event.type === "character_spoke" ? 0.35 : 0.2,
        occurredAt: event.createdAt,
      });
      const previous = this.repository.getRuntimeState(event.sessionId, characterId);
      this.repository.saveRuntimeState({
        sessionId: event.sessionId, characterId,
        attention: unique([String(event.payload.characterId ?? event.causation.playerActionId ?? "world"), ...(previous?.attention ?? [])]).slice(0, 3),
        emotions: previous?.emotions ?? [], activeGoals: previous?.activeGoals ?? [],
        currentPlan: previous?.currentPlan, expressionStrategy: previous?.expressionStrategy,
        updatedAt: event.createdAt,
      });
    }
  }
}

function describeEvidence(event: GameEvent): string {
  if (event.type === "player_spoke") return `${event.payload.characterId} said: ${event.payload.text}`;
  if (event.type === "character_spoke") return `${event.payload.characterId} said: ${event.payload.text}`;
  if (event.type === "character_moved") return `${event.payload.characterId} moved from ${event.payload.from} to ${event.payload.to}.`;
  if (event.type === "object_inspected") return `${event.payload.characterId} inspected ${event.payload.objectId}.`;
  if (event.type === "object_interacted") return `${event.payload.characterId} interacted with ${event.payload.objectId}.`;
  if (event.type === "character_introduced") return `${event.payload.characterId} appeared at ${event.payload.locationId}.`;
  if (event.type === "battle_started") return `Battle ${event.payload.battleId} began at ${event.payload.locationId}.`;
  if (event.type === "battle_round_resolved") return `Battle round ${event.payload.turn} was resolved through ${event.payload.participation}.`;
  if (event.type === "battle_finished") return `Battle ${event.payload.battleId} ended with ${event.payload.outcome}.`;
  return `An attempted action was rejected: ${event.payload.reason}.`;
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
