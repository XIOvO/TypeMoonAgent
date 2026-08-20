import type { ActionResult, GameEvent, GameState, PlayerPrivateNote } from "../core/contracts.js";
import type { BranchEventProjector } from "../core/worldline.js";
import type { EventTaskScheduler } from "../core/durable-jobs.js";
import { SqliteCifFeedbackSink, type CifFeedbackSink } from "../cif/feedback.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";

export interface PendingTurnCommit {
  actionId: string;
  /** Required for Runtime-originated actions; omitted only by trusted legacy callers. */
  requestFingerprint?: string;
  sessionId: string;
  stateRevision: number;
  worldState: GameState;
  events: GameEvent[];
  recipientsByEventId: ReadonlyMap<string, readonly string[]>;
  playerPrivateNote?: PlayerPrivateNote;
  /** Additional deterministic writes that must succeed with this turn. */
  commitEffects?: readonly (() => void)[];
}

export interface TurnCommitter {
  commit(turn: PendingTurnCommit): void;
  getProcessedActionResult?(actionId: string, requestFingerprint: string): ActionResult | undefined;
}

/** One durable boundary for objective history, subjective evidence and idempotency. */
export class SqliteTurnCommitter implements TurnCommitter {
  private readonly feedback: CifFeedbackSink;

  public constructor(private readonly repository: SqliteCifRepository, feedback?: CifFeedbackSink, private readonly worldline?: BranchEventProjector, private readonly scheduler?: EventTaskScheduler) {
    this.feedback = feedback ?? new SqliteCifFeedbackSink(repository);
  }

  public commit(turn: PendingTurnCommit): void {
    this.repository.transaction(() => {
      this.repository.saveWorldState(turn.worldState, new Date().toISOString());
      for (const event of turn.events) this.feedback.record(event, turn.recipientsByEventId.get(event.id) ?? []);
      this.worldline?.project(turn.events);
      this.scheduler?.schedule(turn.events);
      this.grantDialogueBond(turn);
      if (turn.playerPrivateNote) this.repository.savePlayerPrivateNote(turn.playerPrivateNote);
      for (const effect of turn.commitEffects ?? []) effect();
      this.repository.recordProcessedAction({
        actionId: turn.actionId, requestFingerprint: turn.requestFingerprint ?? `trusted:${turn.actionId}`, sessionId: turn.sessionId,
        eventIds: turn.events.map((event) => event.id), stateRevision: turn.stateRevision,
        createdAt: new Date().toISOString(),
      });
    });
  }

  public getProcessedActionResult(actionId: string, requestFingerprint: string): ActionResult | undefined {
    return this.repository.getProcessedActionResult(actionId, requestFingerprint);
  }

  private grantDialogueBond(turn: PendingTurnCommit): void {
    const reply = turn.events.find((event) => event.type === "character_spoke"
      && typeof event.causation.playerActionId === "string"
      && typeof event.payload.characterId === "string");
    const playerSpeech = turn.events.find((event) => event.type === "player_spoke" && typeof event.payload.targetId === "string")
      ?? (reply ? this.repository.listObjectiveHistory({ sessionId: turn.sessionId, types: ["player_spoke"], limit: 1_000 })
        .find((event) => event.causation.playerActionId === reply.causation.playerActionId && event.payload.targetId === reply.payload.characterId) : undefined);
    if (!playerSpeech) return;
    const playerId = typeof playerSpeech.payload.characterId === "string" ? playerSpeech.payload.characterId : undefined;
    const characterId = typeof playerSpeech.payload.targetId === "string" ? playerSpeech.payload.targetId : undefined;
    if (!playerId || !characterId) return;
    const replied = turn.events.some((event) => event.type === "character_spoke"
      && event.causation.playerActionId === playerSpeech.causation.playerActionId
      && event.payload.characterId === characterId);
    if (!replied) return;
    const sourceEventIds = new Set(turn.events.filter((event) => event.causation.playerActionId === playerSpeech.causation.playerActionId).map((event) => event.id));
    sourceEventIds.add(playerSpeech.id);
    this.repository.grantBond({ actionId: playerSpeech.causation.playerActionId ?? turn.actionId, sessionId: turn.sessionId, playerId, characterId, points: 1,
      sourceEventIds: [...sourceEventIds],
      createdAt: playerSpeech.createdAt });
  }
}
