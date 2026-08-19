import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";

test("durable jobs deduplicate delivery and reclaim an abandoned lease", () => {
  const repository = new SqliteCifRepository();
  const job = {
    id: "job-1", sessionId: "demo", kind: "memory.l1", dedupeKey: "scene:42:mash",
    payload: { characterId: "mash", sourceEventIds: ["event-42"] }, status: "pending" as const,
    attempts: 0, maxAttempts: 3, availableAt: "2026-08-14T10:00:00.000Z", createdAt: "2026-08-14T10:00:00.000Z",
  };
  repository.transaction(() => {
    repository.enqueueDurableJob(job);
    repository.enqueueDurableJob({ ...job, id: "job-duplicate" });
  });
  const first = repository.claimDurableJob({ sessionId: "demo", workerId: "worker-a", now: "2026-08-14T10:00:00.000Z", leaseExpiresBefore: "2026-08-14T09:55:00.000Z" });
  assert.equal(first?.id, "job-1");
  assert.equal(first?.attempts, 1);
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "worker-b", now: "2026-08-14T10:01:00.000Z", leaseExpiresBefore: "2026-08-14T09:56:00.000Z" }), undefined);
  const reclaimed = repository.claimDurableJob({ sessionId: "demo", workerId: "worker-b", now: "2026-08-14T10:06:00.000Z", leaseExpiresBefore: "2026-08-14T10:01:00.000Z" });
  assert.equal(reclaimed?.attempts, 2);
  repository.completeDurableJob("job-1", "worker-b", "2026-08-14T10:06:01.000Z");
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "worker-c", now: "2026-08-14T10:07:00.000Z", leaseExpiresBefore: "2026-08-14T10:02:00.000Z" }), undefined);
  repository.close();
});
