import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../../cif/sqlite-repository.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import type { GameComposition } from "../../platform/contracts.js";
import {
  createSqliteDurableJobsPlugin,
  type DurableJobQueue,
  type EventTaskRegistry,
  WORLD_EVENT_TASKS_CAPABILITY,
  WORLD_JOBS_CAPABILITY,
} from "./durable-jobs.js";

test("system durable-jobs provides transaction-safe queue and event-task capabilities", async () => {
  const repository = new SqliteCifRepository();
  const composition: GameComposition = {
    profileId: "durable-jobs-test",
    plugins: [{ plugin: createSqliteDurableJobsPlugin(repository) }],
  };
  const running = await bootstrap(new CordisPlatformAdapter(), composition);
  const jobs = running.get<DurableJobQueue>(WORLD_JOBS_CAPABILITY);
  const tasks = running.get<EventTaskRegistry>(WORLD_EVENT_TASKS_CAPABILITY);
  let calls = 0;
  tasks.register({ schedule: () => { calls += 1; } });

  repository.transaction(() => {
    tasks.schedule([]);
    jobs.enqueue({
      id: "plugin-job", sessionId: "demo", kind: "test", dedupeKey: "plugin-job", payload: {}, status: "pending",
      attempts: 0, maxAttempts: 1, availableAt: "2030-01-01T00:00:00.000Z", createdAt: "2030-01-01T00:00:00.000Z",
    });
  });
  assert.equal(calls, 1);
  assert.equal(jobs.claim({ sessionId: "demo", workerId: "test", now: "2030-01-01T00:00:00.000Z", leaseExpiresBefore: "2029-12-31T23:55:00.000Z" })?.id, "plugin-job");

  await running.dispose();
  tasks.schedule([]);
  assert.equal(calls, 1);
  repository.close();
});
