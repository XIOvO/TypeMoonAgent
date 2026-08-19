import assert from "node:assert/strict";
import test from "node:test";
import { MemoryConsolidationWorker, type MemoryConsolidationGenerator } from "./memory-consolidator.js";
import { SqliteCifRepository } from "./sqlite-repository.js";
import { SqliteDurableJobQueue } from "../plugins/system/durable-jobs.js";
import { GmSceneContextBuilder } from "../story/scene-context.js";

test("L1 scene consolidation stores an episodic memory and emits a GM-safe projection", async () => {
  const repository = new SqliteCifRepository();
  repository.saveEvidence({ id: "e-1", sessionId: "demo", characterId: "mash", kind: "observation", content: "The player publicly promised to return after the battle.", sourceEventIds: ["event-1"], reliability: 1, importance: 0.8, occurredAt: "2026-08-12T20:00:00Z" });
  repository.enqueueDurableJob({ id: "task-1", sessionId: "demo", kind: "memory.l1", dedupeKey: "test:task-1", payload: { characterId: "mash", trigger: "battle_aftermath", sourceEvidenceIds: ["e-1"], participantIds: ["mash", "player"], locationId: "courtyard" }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: "2026-08-12T20:10:00Z", createdAt: "2026-08-12T20:10:00Z" });
  const generator: MemoryConsolidationGenerator = { async generate() {
    return {
      shouldRemember: true, summary: "After the battle, the player promised to return.",
      subjectiveInterpretation: "Mash cautiously felt less alone.", emotions: [{ type: "relief", intensity: 0.6, targetId: "player" }], salience: 0.7,
      publicSummary: "After the battle, the player publicly promised to return.",
      openThreads: ["Will the player return as promised?"], storyPressures: ["The public promise can be tested by the next danger."],
    };
  } };
  assert.equal(await new MemoryConsolidationWorker(new SqliteDurableJobQueue(repository), repository, generator).processNext("demo"), true);
  assert.equal(repository.listEpisodeMemories("demo", "mash").length, 1);
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "memory.l2", now: "2030-08-12T20:00:00Z", leaseExpiresBefore: "2030-08-12T19:55:00Z" }), undefined);
  const gmContext = new GmSceneContextBuilder(repository).build("demo");
  assert.deepEqual(gmContext.openThreads, ["Will the player return as promised?"]);
  assert.doesNotMatch(JSON.stringify(gmContext), /less alone/);
  repository.close();
});

test("failed consolidation remains durable and is claimed again after its retry time", async () => {
  const repository = new SqliteCifRepository();
  repository.saveEvidence({ id: "e-1", sessionId: "demo", characterId: "mash", kind: "observation", content: "A scene ended.", sourceEventIds: ["event-1"], reliability: 1, importance: 0.8, occurredAt: "2026-08-12T20:00:00Z" });
  repository.enqueueDurableJob({ id: "task-retry", sessionId: "demo", kind: "memory.l1", dedupeKey: "test:task-retry", payload: { characterId: "mash", trigger: "battle_aftermath", sourceEvidenceIds: ["e-1"], participantIds: ["mash"] }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: "2026-08-12T20:00:00Z", createdAt: "2026-08-12T20:00:00Z" });
  let calls = 0;
  const worker = new MemoryConsolidationWorker(new SqliteDurableJobQueue(repository), repository, { async generate() { calls += 1; if (calls === 1) throw new Error("model_unavailable"); return { shouldRemember: false }; } });
  await worker.processNext("demo", new Date("2026-08-12T20:00:00Z"));
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "memory.l1", now: "2026-08-12T20:00:01Z", leaseExpiresBefore: "2026-08-12T19:55:01Z" }), undefined);
  assert.equal(await worker.processNext("demo", new Date("2026-08-12T20:00:03Z")), true);
  assert.equal(calls, 2);
  repository.close();
});

test("an abandoned L1 delivery lease can be reclaimed after restart", () => {
  const repository = new SqliteCifRepository();
  repository.enqueueDurableJob({ id: "task-lease", sessionId: "demo", kind: "memory.l1", dedupeKey: "test:task-lease", payload: { characterId: "mash", trigger: "battle_aftermath", sourceEvidenceIds: ["e-1"], participantIds: ["mash"] }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: "2026-08-12T20:00:00Z", createdAt: "2026-08-12T20:00:00Z" });
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "a", kind: "memory.l1", now: "2026-08-12T20:00:00Z", leaseExpiresBefore: "2026-08-12T19:55:00Z" })?.attempts, 1);
  const reclaimed = repository.claimDurableJob({ sessionId: "demo", workerId: "b", kind: "memory.l1", now: "2026-08-12T20:06:00Z", leaseExpiresBefore: "2026-08-12T20:01:00Z" });
  assert.equal(reclaimed?.attempts, 2);
  repository.close();
});
