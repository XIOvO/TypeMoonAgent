import assert from "node:assert/strict";
import test from "node:test";
import type { GameEvent } from "./core/contracts.js";
import { SqliteCifRepository } from "./cif/sqlite-repository.js";
import { SqliteTurnCommitter } from "./persistence/turn-commit.js";

const event = (id: string, sequence: number): GameEvent => ({
  id, sessionId: "demo", createdAt: "2026-08-11T10:00:00Z", sequence,
  type: "character_spoke", payload: { characterId: "mash", text: "Understood." },
  causation: { playerActionId: "action-1" }, stateRevision: sequence,
});

test("TurnCommit durably writes a whole event batch with its character evidence", () => {
  const repository = new SqliteCifRepository();
  const first = event("event-1", 1);
  const second = event("event-2", 2);
  new SqliteTurnCommitter(repository).commit({
    actionId: "action-1", sessionId: "demo", stateRevision: 2, events: [first, second],
    worldState: { sessionId: "demo", revision: 2, characters: {}, locations: {} },
    recipientsByEventId: new Map([[first.id, ["mash", "player"]], [second.id, ["mash"]]]),
  });
  assert.equal(repository.countObjectiveHistory("demo"), 2);
  assert.equal(repository.listEvidence("demo", "mash", 5).length, 2);
  assert.equal(repository.listEvidence("demo", "player", 5).length, 1);
  assert.equal(repository.loadWorldState("demo")?.revision, 2);
  repository.close();
});

test("a failed transaction leaves no partial objective history", () => {
  const repository = new SqliteCifRepository();
  assert.throws(() => repository.transaction(() => {
    repository.appendObjectiveHistory({ id: "event-1", sessionId: "demo", sequence: 1, eventType: "test", payload: {}, createdAt: "2026-08-11T10:00:00Z" });
    throw new Error("forced failure");
  }));
  assert.equal(repository.countObjectiveHistory("demo"), 0);
  repository.close();
});
