import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { EventSequence, SessionId, StateRevision } from "../protocol/ids.js";
import { SqliteSnapshotStore } from "./sqlite-snapshot-store.js";

test("SQLite SnapshotStore reads current schema and derives the persisted event boundary", async () => {
  const repository = new SqliteCifRepository();
  try {
    const store = new SqliteSnapshotStore(repository);
    const sessionId = "session:snapshot" as SessionId;
    await store.save({ sessionId, revision: 1 as StateRevision, lastEventSequence: 0 as EventSequence, schemaVersion: 1, createdAt: "2026-08-20T00:00:00.000Z", state: { sessionId, revision: 1, characters: {}, locations: {} } });
    repository.appendObjectiveHistory({ id: "event:snapshot", sessionId, sequence: 1, eventType: "test", payload: {}, createdAt: "2026-08-20T00:00:01.000Z" });
    const loaded = await store.load(sessionId);
    assert.equal(loaded?.schemaVersion, 1);
    assert.equal(loaded?.lastEventSequence, 1);
  } finally { repository.close(); }
});
