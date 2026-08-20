import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { DurableJob } from "../core/durable-jobs.js";
import type { SessionId } from "../protocol/ids.js";
import { SqliteJobStore } from "./sqlite-job-store.js";

test("SQLite JobStore preserves durable job claim and completion behavior", async () => {
  const repository = new SqliteCifRepository();
  try {
    const store = new SqliteJobStore(repository);
    const job: DurableJob = {
      id: "job:adapter", sessionId: "session:adapter" as SessionId, kind: "test", dedupeKey: "one",
      payload: { value: 1 }, status: "pending", attempts: 0, maxAttempts: 2,
      availableAt: "2026-08-20T00:00:00.000Z", createdAt: "2026-08-20T00:00:00.000Z",
    };
    await store.enqueue(job);
    const claimed = await store.claim({ sessionId: job.sessionId as SessionId, workerId: "worker", now: "2026-08-20T00:01:00.000Z", leaseExpiresBefore: "2026-08-20T00:00:00.000Z" });
    assert.equal(claimed?.id, job.id);
    assert.equal(claimed?.status, "processing");
    await store.complete(job.id, "worker", "2026-08-20T00:02:00.000Z");
    assert.equal(await store.claim({ sessionId: job.sessionId as SessionId, workerId: "worker", now: "2026-08-20T00:03:00.000Z", leaseExpiresBefore: "2026-08-20T00:00:00.000Z" }), undefined);
  } finally {
    repository.close();
  }
});
