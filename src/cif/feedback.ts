import type { GameEvent } from "../core/contracts.js";
import { SqliteCifRepository } from "./sqlite-repository.js";
import { contextTagsForConfirmedEvent, importanceForContextTags } from "./context-tags.js";

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
    const contextTags = contextTagsForConfirmedEvent(event);
    this.repository.appendObjectiveHistory({
      id: event.id, sessionId: event.sessionId, sequence: event.sequence,
      eventType: event.type, payload: event.payload, causation: event.causation, stateRevision: event.stateRevision, moment: event.moment, createdAt: event.createdAt,
    });
    for (const characterId of new Set(recipientIds)) {
      const evidenceId = `${event.id}:${characterId}`;
      this.repository.saveEvidence({
        id: evidenceId, sessionId: event.sessionId, characterId,
        kind: "observation", content: describeEvidence(event), sourceEventIds: [event.id],
        sourceType: "world_event", sourceTrust: 1, verifiedStatus: "verified", recallCues: contextTags,
        reliability: 1, importance: event.type === "character_spoke" ? 0.35 : importanceForContextTags(contextTags),
        occurredAt: event.createdAt,
      });
      this.repository.appendEvidenceToOpenMemoryWindows(event.sessionId, characterId, evidenceId);
      const previous = this.repository.getRuntimeState(event.sessionId, characterId);
      this.repository.saveRuntimeState({
        sessionId: event.sessionId, characterId,
        attention: unique([String(event.payload.characterId ?? event.causation.playerActionId ?? "world"), ...(previous?.attention ?? [])]).slice(0, 3),
        emotions: previous?.emotions ?? [], activeGoals: previous?.activeGoals ?? [],
        locationId: previous?.locationId, availability: previous?.availability,
        currentIntention: previous?.currentIntention, currentPlan: previous?.currentPlan, expressionStrategy: previous?.expressionStrategy,
        lastProactiveInteractionTick: previous?.lastProactiveInteractionTick,
        knownPlayerLocationId: learnedPlayerLocation(event, previous), approachPlayer: previous?.approachPlayer,
        updatedAt: event.createdAt,
      });
    }
    this.applyMemoryTriggers(event, recipientIds);
  }

  private applyMemoryTriggers(event: GameEvent, recipientIds: readonly string[]): void {
    const locationId = typeof event.payload.locationId === "string" ? event.payload.locationId : undefined;
    if (event.type === "battle_finished") {
      for (const characterId of new Set(recipientIds)) this.repository.openMemorySceneWindow({
        sessionId: event.sessionId, characterId, trigger: "battle_aftermath", evidenceIds: [`${event.id}:${characterId}`],
        participantIds: [...new Set(recipientIds)], locationId, openedAt: event.createdAt,
      });
      return;
    }
    if (event.type === "character_spoke" && isImportantDirectDialogue(event)) {
      const characterId = typeof event.payload.characterId === "string" ? event.payload.characterId : undefined;
      const targetId = typeof event.payload.targetId === "string" ? event.payload.targetId : undefined;
      if (characterId && targetId) this.repository.openMemorySceneWindow({
        sessionId: event.sessionId, characterId, trigger: "important_dialogue", evidenceIds: [`${event.id}:${characterId}`],
        participantIds: [characterId, targetId], locationId, openedAt: event.createdAt,
      });
    }
    const departure = event.type === "character_moved" ? event.payload.from : event.type === "time_waited" ? event.payload.locationId : undefined;
    if (typeof departure === "string") this.repository.closeMemorySceneWindowsAt(event.sessionId, departure, event.createdAt);
  }
}

function describeEvidence(event: GameEvent): string {
  if (event.type === "player_spoke") return `${event.payload.characterId} said: ${event.payload.text}`;
  if (event.type === "character_spoke") return `${event.payload.characterId} said: ${event.payload.text}`;
  if (event.type === "character_moved") return `${event.payload.characterId} moved from ${event.payload.from} to ${event.payload.to}.`;
  if (event.type === "object_inspected") return `${event.payload.characterId} inspected ${event.payload.objectId}.`;
  if (event.type === "object_interacted") return `${event.payload.characterId} interacted with ${event.payload.objectId}.`;
  if (event.type === "character_introduced") return `${event.payload.characterId} appeared at ${event.payload.locationId}.`;
  if (event.type === "chapter_entered") return `The story entered ${event.payload.contentType}:${event.payload.contentId}.`;
  if (event.type === "battle_started") return `Battle ${event.payload.battleId} began at ${event.payload.locationId}.`;
  if (event.type === "battle_round_resolved") return `Battle round ${event.payload.turn} was resolved through ${event.payload.participation}.`;
  if (event.type === "battle_finished") return `Battle ${event.payload.battleId} ended with ${event.payload.outcome}.`;
  return `An attempted action was rejected: ${event.payload.reason}.`;
}

function unique(values: string[]): string[] { return [...new Set(values)]; }

function learnedPlayerLocation(event: GameEvent, previous: ReturnType<SqliteCifRepository["getRuntimeState"]>): string | undefined {
  if (event.payload.characterId !== "player") return previous?.knownPlayerLocationId;
  const location = event.type === "character_moved" ? event.payload.to : event.payload.locationId;
  return typeof location === "string" ? location : previous?.knownPlayerLocationId;
}

/** A low-cost candidate gate; L1 still decides whether the scene merits a memory. */
function isImportantDirectDialogue(event: GameEvent): boolean {
  const text = typeof event.payload.text === "string" ? event.payload.text.trim() : "";
  if (typeof event.payload.targetId !== "string") return false;
  if (text.length >= 36) return true;
  return /答应|承诺|约定|再见|告别|对不起|抱歉|谢谢|感谢|喜欢|害怕|救|离开|回来|相信|promise|sorry|thank|goodbye|return/i.test(text);
}
