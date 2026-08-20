import assert from "node:assert/strict";
import test from "node:test";
import type { EventId, EventSequence, JobId, SessionId, StateRevision } from "../../protocol/ids.js";
import type { EventStore, JobStore, MigrationStore, SnapshotStore, StateSnapshot } from "./index.js";

interface TestEvent { id: EventId; sessionId: SessionId; type: string; }
interface TestState { locationId: string; }
interface TestJob { id: JobId; sessionId: SessionId; }

test("persistence ports are implementable without a database dependency", async () => {
  const sessionId = "session:demo" as SessionId;
  const event = { id: "event-1" as EventId, sessionId, type: "player_spoke" };
  const snapshot: StateSnapshot<TestState> = {
    sessionId, revision: 3 as StateRevision, lastEventSequence: 7 as EventSequence,
    schemaVersion: 1, state: { locationId: "hall" }, createdAt: "2026-08-20T00:00:00.000Z",
  };
  const job = { id: "job-1" as JobId, sessionId };
  const events: TestEvent[] = [];
  const snapshots = new Map<SessionId, StateSnapshot<TestState>>();
  const jobs: TestJob[] = [];
  const migrations: Array<{ id: string; checksum: string; appliedAt: string }> = [];
  const lifecycle: string[] = [];

  const eventStore: EventStore<TestEvent> = {
    append: async (_sessionId, appended) => { events.push(...appended); },
    list: async (query) => events.filter((item) => item.sessionId === query.sessionId),
    getByIds: async (querySessionId, ids) => events.filter((item) => item.sessionId === querySessionId && ids.includes(item.id)),
  };
  const snapshotStore: SnapshotStore<TestState> = {
    load: async (id) => snapshots.get(id),
    save: async (value) => { snapshots.set(value.sessionId, value); },
  };
  const jobStore: JobStore<TestJob> = {
    enqueue: async (value) => { jobs.push(value); },
    claim: async () => jobs.shift(),
    complete: async (id) => { lifecycle.push(`complete:${id}`); },
    retry: async (id) => { lifecycle.push(`retry:${id}`); },
    defer: async (id) => { lifecycle.push(`defer:${id}`); },
  };
  const migrationStore: MigrationStore = {
    listApplied: async () => [...migrations],
    recordApplied: async (migration) => { migrations.push(migration); },
  };

  await eventStore.append(sessionId, [event]);
  await snapshotStore.save(snapshot);
  await jobStore.enqueue(job);
  await migrationStore.recordApplied({ id: "001-initial", checksum: "abc123", appliedAt: "2026-08-20T00:00:00.000Z" });

  assert.deepEqual(await eventStore.list({ sessionId }), [event]);
  assert.deepEqual(await eventStore.getByIds(sessionId, [event.id]), [event]);
  assert.deepEqual(await snapshotStore.load(sessionId), snapshot);
  assert.deepEqual(await jobStore.claim({ sessionId, workerId: "worker", now: "2026-08-20T00:00:00.000Z", leaseExpiresBefore: "2026-08-19T23:55:00.000Z" }), job);
  await jobStore.complete(job.id, "worker", "2026-08-20T00:01:00.000Z");
  await jobStore.retry(job.id, "worker", "temporary", "2026-08-20T00:02:00.000Z");
  await jobStore.defer(job.id, "worker", "2026-08-20T00:03:00.000Z");
  assert.deepEqual(lifecycle, ["complete:job-1", "retry:job-1", "defer:job-1"]);
  assert.deepEqual(await migrationStore.listApplied(), [{ id: "001-initial", checksum: "abc123", appliedAt: "2026-08-20T00:00:00.000Z" }]);
});
