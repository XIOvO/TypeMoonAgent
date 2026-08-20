import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { GameEvent } from "../core/contracts.js";
import type { EventSequence, SessionId } from "../protocol/ids.js";
import { SqliteEventStore } from "./sqlite-event-store.js";

test("SQLite EventStore appends and queries ordered objective history", async () => {
  const repository = new SqliteCifRepository();
  try {
    const store = new SqliteEventStore(repository);
    const sessionId = "session:event-store" as SessionId;
    const event = (id: string, sequence: number, type: GameEvent["type"]): GameEvent => ({ id, sessionId, sequence: sequence as EventSequence, type, payload: {}, causation: {}, stateRevision: sequence, createdAt: "2026-08-20T00:00:00.000Z" });
    await store.append(sessionId, [event("event:1", 1, "player_spoke"), event("event:2", 2, "character_spoke")]);
    assert.deepEqual((await store.list({ sessionId, afterSequence: 1 as EventSequence })).map((item) => item.id), ["event:2"]);
    assert.deepEqual((await store.list({ sessionId, types: ["player_spoke"] })).map((item) => item.id), ["event:1"]);
    assert.deepEqual((await store.getByIds(sessionId, ["event:2", "event:1"])).map((item) => item.id), ["event:2", "event:1"]);
  } finally { repository.close(); }
});
