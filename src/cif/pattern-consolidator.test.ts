import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDurableJobQueue } from "../plugins/system/durable-jobs.js";
import { SqliteCifRepository } from "./sqlite-repository.js";
import { CifPatternPublisher } from "./pattern-publisher.js";
import { PatternAuditWorker, PatternConsolidationWorker } from "./pattern-consolidator.js";

test("L2 creates a cited review draft after two L1 memories without changing live CIF", async () => {
  const repository = new SqliteCifRepository();
  addEpisode(repository, "one", "2026-08-01T00:00:00.000Z");
  addEpisode(repository, "two", "2026-08-02T00:00:00.000Z");
  addJob(repository, "two");
  const worker = new PatternConsolidationWorker(new SqliteDurableJobQueue(repository), repository, { async generate() {
    return { shouldPropose: true, characterId: "mash", sourceEpisodeIds: ["episode-one", "episode-two"], rationale: "Two separate scenes show the same pattern.", relationship: { targetId: "player", content: "Mash cautiously expects the player to keep promises.", confidence: 0.7 } };
  } });
  assert.equal(await worker.processNext("demo", new Date("2026-08-03T00:00:00.000Z")), true);
  assert.equal(repository.listPatternDrafts("demo", "mash")[0]?.status, "pending_audit");
  const audit = new PatternAuditWorker(new SqliteDurableJobQueue(repository), repository, { async audit() {
    return { layer: "l2", decision: "approve", risk: "low", citedInputIds: ["episode-one", "episode-two"], rationale: "The two scenes support a small social interpretation.", policyVersion: 1 };
  } }, new CifPatternPublisher(repository));
  assert.equal(await audit.processNext("demo", new Date("2026-08-03T00:01:00.000Z")), true);
  assert.equal(repository.listPatternDrafts("demo", "mash")[0]?.status, "published");
  assert.equal(repository.listInterpretiveModels("demo", "mash", 5)[0]?.targetId, "player");
  assert.equal(repository.listEpistemicStates("demo", "mash", 5).length, 0);
  repository.close();
});

test("L2 rejects an uncited draft instead of publishing a pattern", async () => {
  const repository = new SqliteCifRepository();
  addEpisode(repository, "one", "2026-08-01T00:00:00.000Z");
  addEpisode(repository, "two", "2026-08-02T00:00:00.000Z");
  addJob(repository, "two");
  const worker = new PatternConsolidationWorker(new SqliteDurableJobQueue(repository), repository, { async generate() {
    return { shouldPropose: true, characterId: "mash", sourceEpisodeIds: ["episode-two"], rationale: "One scene is enough.", recurringGoal: { content: "Stay near the player.", confidence: 0.8 } };
  } });
  await worker.processNext("demo", new Date("2026-08-03T00:00:00.000Z"));
  assert.deepEqual(repository.listPatternDrafts("demo", "mash")[0]?.validationErrors, ["pattern_requires_two_distinct_episodes"]);
  assert.equal(repository.listPatternDrafts("demo", "mash")[0]?.status, "invalid");
  repository.close();
});

test("L2 defers a high-risk audit even when the auditor asks to approve", async () => {
  const repository = new SqliteCifRepository();
  addEpisode(repository, "one", "2026-08-01T00:00:00.000Z");
  addEpisode(repository, "two", "2026-08-02T00:00:00.000Z");
  repository.savePatternDraft({ id: "pattern-high-risk", sessionId: "demo", characterId: "mash", triggerEpisodeId: "episode-two", status: "pending_audit", proposal: {
    shouldPropose: true, characterId: "mash", sourceEpisodeIds: ["episode-one", "episode-two"], rationale: "Two scenes support a small social interpretation.",
    relationship: { targetId: "player", content: "Mash cautiously expects the player to keep promises.", confidence: 0.7 },
  }, validationErrors: [], generator: "test", createdAt: "2026-08-03T00:00:00.000Z" });
  repository.enqueueDurableJob({ id: "job-l2-audit", sessionId: "demo", kind: "memory.l2.audit", dedupeKey: "pattern-high-risk", payload: { draftId: "pattern-high-risk" }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: "2026-08-03T00:00:00.000Z", createdAt: "2026-08-03T00:00:00.000Z" });
  const worker = new PatternAuditWorker(new SqliteDurableJobQueue(repository), repository, { async audit() {
    return { layer: "l2", decision: "approve", risk: "high", citedInputIds: ["episode-one", "episode-two"], rationale: "The evidence is real, but the proposed change is too consequential.", policyVersion: 1 };
  } }, new CifPatternPublisher(repository));
  assert.equal(await worker.processNext("demo", new Date("2026-08-03T00:01:00.000Z")), true);
  assert.equal(repository.getPatternDraft("pattern-high-risk")?.status, "deferred");
  assert.equal(repository.listInterpretiveModels("demo", "mash", 5).length, 0);
  repository.close();
});

function addEpisode(repository: SqliteCifRepository, id: string, occurredAt: string): void {
  repository.saveEpisodeMemory({ id: `episode-${id}`, sessionId: "demo", ownerId: "mash", sourceEventIds: [`event-${id}`], factualAnchorIds: [], summary: `Scene ${id}`, emotions: [], participantIds: ["mash", "player"], salience: 0.8, status: "active", occurredAt });
}
function addJob(repository: SqliteCifRepository, episodeId: string): void {
  repository.enqueueDurableJob({ id: "job-l2", sessionId: "demo", kind: "memory.l2", dedupeKey: "mash:episode-two", payload: { characterId: "mash", triggerEpisodeId: `episode-${episodeId}` }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: "2026-08-03T00:00:00.000Z", createdAt: "2026-08-03T00:00:00.000Z" });
}
