import assert from "node:assert/strict";
import test from "node:test";
import type { GameEvent } from "../core/contracts.js";
import { SqliteCifFeedbackSink } from "./feedback.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

test("feedback appends objective history but only grants evidence to witnesses", () => {
  const repository = new SqliteCifRepository();
  const sink = new SqliteCifFeedbackSink(repository);
  const event: GameEvent = { id: "event-1", sessionId: "demo", createdAt: "2026-08-11T10:00:00Z", sequence: 1, type: "character_spoke", payload: { characterId: "mash", text: "I am here." }, causation: { playerActionId: "action-1" }, stateRevision: 1 };
  sink.record(event, ["mash", "player"]);
  assert.equal(repository.listEvidence("demo", "mash", 5).length, 1);
  assert.equal(repository.listEvidence("demo", "player", 5).length, 1);
  assert.equal(repository.listEvidence("demo", "unseen_character", 5).length, 0);
  assert.equal(repository.getRuntimeState("demo", "player")?.attention[0], "mash");
  repository.close();
});

test("battle aftermath waits for the next scene boundary before queuing character-specific consolidation", () => {
  const repository = new SqliteCifRepository();
  const sink = new SqliteCifFeedbackSink(repository);
  const event = (id: string, sequence: number, type: GameEvent["type"], payload: Record<string, unknown>): GameEvent => ({
    id, sessionId: "demo", createdAt: `2026-08-12T20:0${sequence}:00Z`, sequence, type, payload, causation: {}, stateRevision: sequence,
  });
  sink.record(event("battle-end", 1, "battle_finished", { battleId: "b-1", locationId: "courtyard", outcome: "victory" }), ["mash", "player"]);
  assert.deepEqual(repository.listEvidence("demo", "mash", 5)[0]?.recallCues, ["battle_aftermath", "major_confirmed"]);
  assert.equal(repository.listEvidence("demo", "mash", 5)[0]?.importance, 0.9);
  sink.record(event("talk", 2, "player_spoke", { characterId: "player", text: "I will not leave you behind." }), ["mash", "player"]);
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "memory.l1", now: "2026-08-12T20:02:00Z", leaseExpiresBefore: "2026-08-12T19:57:00Z" }), undefined);
  sink.record(event("leave", 3, "character_moved", { characterId: "player", from: "courtyard", to: "hall" }), ["player"]);
  const job = repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "memory.l1", now: "2026-08-12T20:03:00Z", leaseExpiresBefore: "2026-08-12T19:58:00Z" });
  assert.equal(job?.payload.trigger, "battle_aftermath");
  assert.ok((job?.payload.sourceEvidenceIds as string[]).includes("talk:mash"));
  assert.equal(job?.payload.characterId, "mash");
  repository.close();
});

test("a direct promise opens an L1 candidate window, while ordinary short dialogue does not", () => {
  const repository = new SqliteCifRepository();
  const sink = new SqliteCifFeedbackSink(repository);
  const event = (id: string, sequence: number, payload: Record<string, unknown>): GameEvent => ({
    id, sessionId: "demo", createdAt: `2026-08-12T21:0${sequence}:00Z`, sequence, type: "character_spoke", payload,
    causation: { playerActionId: `action-${sequence}` }, stateRevision: sequence,
  });
  sink.record(event("small-talk", 1, { characterId: "mash", targetId: "player", locationId: "courtyard", text: "好的，前辈。" }), ["mash", "player"]);
  sink.record({ id: "leave-1", sessionId: "demo", createdAt: "2026-08-12T21:02:00Z", sequence: 2, type: "character_moved", payload: { characterId: "player", from: "courtyard", to: "hall" }, causation: {}, stateRevision: 2 }, ["player"]);
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "memory.l1", now: "2026-08-12T21:03:00Z", leaseExpiresBefore: "2026-08-12T20:58:00Z" }), undefined);
  sink.record(event("promise", 3, { characterId: "mash", targetId: "player", locationId: "hall", text: "我答应您，无论发生什么都会回来。" }), ["mash", "player"]);
  sink.record({ id: "leave-2", sessionId: "demo", createdAt: "2026-08-12T21:04:00Z", sequence: 4, type: "character_moved", payload: { characterId: "player", from: "hall", to: "gate" }, causation: {}, stateRevision: 4 }, ["player"]);
  const job = repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "memory.l1", now: "2026-08-12T21:05:00Z", leaseExpiresBefore: "2026-08-12T21:00:00Z" });
  assert.equal(job?.payload.trigger, "important_dialogue");
  assert.deepEqual(job?.payload.participantIds, ["mash", "player"]);
  repository.close();
});
