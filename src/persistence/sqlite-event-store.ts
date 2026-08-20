import type { GameEvent } from "../core/contracts.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { EventQuery, EventStore } from "./contracts/index.js";

/** SQLite adapter for the append-only objective event history. */
export class SqliteEventStore implements EventStore<GameEvent> {
  public constructor(private readonly repository: SqliteCifRepository) {}

  public async append(sessionId: string, events: readonly GameEvent[]): Promise<void> {
    for (const event of events) {
      if (event.sessionId !== sessionId) throw new Error("event_store_session_mismatch");
      this.repository.appendObjectiveHistory({ ...event, eventType: event.type });
    }
  }

  public async list(query: EventQuery): Promise<GameEvent[]> { return this.repository.listObjectiveHistory(query); }
  public async getByIds(sessionId: string, eventIds: readonly string[]): Promise<GameEvent[]> { return this.repository.listObjectiveHistoryByIds(sessionId, eventIds); }
}
