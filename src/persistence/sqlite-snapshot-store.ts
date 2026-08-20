import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { GameState } from "../core/contracts.js";
import type { EventSequence, SessionId, StateRevision } from "../protocol/ids.js";
import type { SnapshotStore, StateSnapshot } from "./contracts/index.js";

/** SQLite adapter whose event boundary is derived from persisted objective history. */
export class SqliteSnapshotStore implements SnapshotStore<GameState> {
  public constructor(private readonly repository: SqliteCifRepository) {}

  public async load(sessionId: SessionId): Promise<StateSnapshot<GameState> | undefined> {
    const snapshot = this.repository.loadWorldStateSnapshot(sessionId);
    return snapshot && {
      sessionId, state: snapshot.state, schemaVersion: snapshot.schemaVersion,
      revision: snapshot.state.revision as StateRevision,
      lastEventSequence: snapshot.lastEventSequence as EventSequence,
      createdAt: snapshot.updatedAt,
    };
  }

  public async save(snapshot: StateSnapshot<GameState>): Promise<void> {
    if (snapshot.state.sessionId !== snapshot.sessionId || snapshot.state.revision !== snapshot.revision) throw new Error("snapshot_store_mismatch");
    this.repository.saveWorldState(snapshot.state, snapshot.createdAt);
  }
}
