import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDurableJobQueue } from "../plugins/system/durable-jobs.js";
import { CifL3RevisionAuditWorker, CifL3RevisionWorker } from "./l3-revision-worker.js";
import { CifL3RevisionPublisher } from "./l3-revision-publisher.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

test("L3 appends one audited adaptive identity version and exposes only the latest version", async () => {
  const repository = new SqliteCifRepository();
  repository.saveIdentity({ id: "identity-1", sessionId: "demo", characterId: "mash", section: "practical_judgment", content: "She protects others before herself.", sourceIds: ["canon-1"], version: 1 });
  for (const id of ["one", "two", "three"]) repository.saveEpisodeMemory({ id: `episode-${id}`, sessionId: "demo", ownerId: "mash", sourceEventIds: [], factualAnchorIds: [], summary: id, emotions: [], participantIds: ["player"], salience: 0.8, status: "active", occurredAt: `2026-08-0${id === "one" ? 1 : id === "two" ? 2 : 3}T00:00:00.000Z` });
  repository.enqueueDurableJob({ id: "l3-job", sessionId: "demo", kind: "memory.l3", dedupeKey: "mash:episode-three", payload: { characterId: "mash", triggerEpisodeId: "episode-three" }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: "2026-08-04T00:00:00.000Z", createdAt: "2026-08-04T00:00:00.000Z" });
  const jobs = new SqliteDurableJobQueue(repository);
  const generator = new CifL3RevisionWorker(jobs, repository, { async generate() { return { characterId: "mash", revisions: [{ section: "practical_judgment", proposedContent: "She protects others while accepting trusted help.", rationale: "Three scenes show a stable willingness to rely on allies.", sourceEpisodeIds: ["episode-one", "episode-two", "episode-three"], confidence: "high" }], reviewFlags: [] }; } });
  assert.equal(await generator.processNext("demo", new Date("2026-08-04T00:00:00.000Z")), true);
  const auditor = new CifL3RevisionAuditWorker(jobs, repository, { async audit() { return { layer: "l3", decision: "approve", risk: "low", citedInputIds: ["episode-one", "episode-two", "episode-three"], rationale: "The change is narrow, gradual, and well-supported.", policyVersion: 1 }; } }, new CifL3RevisionPublisher(repository));
  assert.equal(await auditor.processNext("demo", new Date("2026-08-04T00:01:00.000Z")), true);
  assert.equal(repository.listIdentity("demo", "mash").length, 1);
  assert.equal(repository.listIdentity("demo", "mash")[0]?.content, "She protects others while accepting trusted help.");
  repository.close();
});
