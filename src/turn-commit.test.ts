import assert from "node:assert/strict";
import test from "node:test";
import type { GameEvent } from "./core/contracts.js";
import { SqliteCifRepository } from "./cif/sqlite-repository.js";
import { SqliteTurnCommitter } from "./persistence/turn-commit.js";
import { SqliteDurableJobQueue } from "./plugins/system/durable-jobs.js";

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
  assert.deepEqual(repository.getBond("demo", "player", "mash"), undefined);
  repository.close();
});

test("a completed player-character dialogue grants one durable bond point once", () => {
  const repository = new SqliteCifRepository();
  const playerSpeech: GameEvent = { id: "event-player", sessionId: "demo", sequence: 1, createdAt: "2026-08-11T10:00:00Z",
    type: "player_spoke", payload: { characterId: "player", targetId: "mash", text: "Hello." }, causation: { playerActionId: "action-2" }, stateRevision: 1 };
  const reply: GameEvent = { id: "event-mash", sessionId: "demo", sequence: 2, createdAt: "2026-08-11T10:00:01Z",
    type: "character_spoke", payload: { characterId: "mash", text: "Hello, Senpai." }, causation: { playerActionId: "action-2" }, stateRevision: 2 };
  const committer = new SqliteTurnCommitter(repository);
  const turn = { actionId: "action-2", sessionId: "demo", stateRevision: 2, events: [playerSpeech, reply],
    worldState: { sessionId: "demo", revision: 2, characters: {}, locations: {} }, recipientsByEventId: new Map<string, string[]>() };
  committer.commit(turn);
  repository.transaction(() => repository.grantBond({ actionId: "action-2", sessionId: "demo", playerId: "player", characterId: "mash",
    points: 1, sourceEventIds: ["event-player", "event-mash"], createdAt: "2026-08-11T10:00:00Z" }));
  assert.deepEqual(repository.getBond("demo", "player", "mash"), {
    sessionId: "demo", playerId: "player", characterId: "mash", level: 1, points: 1, totalPoints: 1, updatedAt: "2026-08-11T10:00:00Z",
  });
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

test("a failed TurnCommit leaves state, events, receipt, and jobs invisible together", () => {
  const repository = new SqliteCifRepository();
  const queue = new SqliteDurableJobQueue(repository);
  const committed = event("event-outbox", 1);
  assert.throws(() => new SqliteTurnCommitter(repository).commit({
    actionId: "action-outbox", requestFingerprint: "request-outbox", sessionId: "demo", stateRevision: 1,
    worldState: { sessionId: "demo", revision: 1, characters: {}, locations: {} }, events: [committed], recipientsByEventId: new Map(),
    commitEffects: [() => {
      queue.enqueue({ id: "job-outbox", sessionId: "demo", kind: "test", dedupeKey: "outbox", payload: {}, status: "pending", attempts: 0, maxAttempts: 1, availableAt: "2026-08-11T10:00:00Z", createdAt: "2026-08-11T10:00:00Z" });
      throw new Error("outbox failure");
    }],
  }), /outbox failure/);
  assert.equal(repository.loadWorldState("demo"), undefined);
  assert.deepEqual(repository.listObjectiveHistoryByIds("demo", [committed.id]), []);
  assert.equal(new SqliteTurnCommitter(repository).getProcessedActionResult("action-outbox", "request-outbox"), undefined);
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "worker", now: "2026-08-11T10:00:01Z", leaseExpiresBefore: "2026-08-11T10:00:00Z" }), undefined);
  repository.close();
});
