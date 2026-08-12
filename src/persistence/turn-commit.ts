import type { GameEvent, GameState, PlayerPrivateNote } from "../core/contracts.js";
import { SqliteCifFeedbackSink, type CifFeedbackSink } from "../cif/feedback.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";

export interface PendingTurnCommit {
  actionId: string;
  sessionId: string;
  stateRevision: number;
  worldState: GameState;
  events: GameEvent[];
  recipientsByEventId: ReadonlyMap<string, readonly string[]>;
  playerPrivateNote?: PlayerPrivateNote;
}

export interface TurnCommitter {
  commit(turn: PendingTurnCommit): void;
}

/** One durable boundary for objective history, subjective evidence and idempotency. */
export class SqliteTurnCommitter implements TurnCommitter {
  private readonly feedback: CifFeedbackSink;

  public constructor(private readonly repository: SqliteCifRepository, feedback?: CifFeedbackSink) {
    this.feedback = feedback ?? new SqliteCifFeedbackSink(repository);
  }

  public commit(turn: PendingTurnCommit): void {
    this.repository.transaction(() => {
      this.repository.saveWorldState(turn.worldState, new Date().toISOString());
      for (const event of turn.events) this.feedback.record(event, turn.recipientsByEventId.get(event.id) ?? []);
      if (turn.playerPrivateNote) this.repository.savePlayerPrivateNote(turn.playerPrivateNote);
      this.repository.recordProcessedAction({
        actionId: turn.actionId, sessionId: turn.sessionId,
        eventIds: turn.events.map((event) => event.id), stateRevision: turn.stateRevision,
        createdAt: new Date().toISOString(),
      });
    });
  }
}
