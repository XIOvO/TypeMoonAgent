import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../../cif/sqlite-repository.js";
import type { GameEvent } from "../../core/contracts.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import type { GameComposition } from "../../platform/contracts.js";
import { EventTaskRegistry, createSqliteDurableJobsPlugin } from "./durable-jobs.js";
import {
  SYSTEM_TURN_COMMITTER_CAPABILITY,
  WORLD_EVENT_HISTORY_CAPABILITY,
  createSqlitePersistenceSystem,
  type WorldEventHistory,
} from "./persistence.js";
import type { TurnCommitter } from "../../persistence/turn-commit.js";

test("system persistence exposes committed history and the system-only atomic commit port", async () => {
  const repository = new SqliteCifRepository();
  const eventTasks = new EventTaskRegistry();
  const persistence = createSqlitePersistenceSystem(repository, { eventTasks });
  const composition: GameComposition = {
    profileId: "persistence-test",
    plugins: [
      { plugin: createSqliteDurableJobsPlugin(repository, eventTasks) },
      { plugin: persistence.plugin },
    ],
  };
  const running = await bootstrap(new CordisPlatformAdapter(), composition);
  const history = running.get<WorldEventHistory>(WORLD_EVENT_HISTORY_CAPABILITY);
  const committer = running.get<TurnCommitter>(SYSTEM_TURN_COMMITTER_CAPABILITY);
  const event: GameEvent = {
    id: "persisted-event", sessionId: "demo", sequence: 1, createdAt: "2026-08-15T00:00:00.000Z",
    type: "character_spoke", payload: { characterId: "mash", text: "已确认。" },
    causation: { playerActionId: "persisted-action" }, stateRevision: 1,
  };

  committer.commit({
    actionId: "persisted-action", requestFingerprint: "fingerprint", sessionId: "demo", stateRevision: 1,
    worldState: { sessionId: "demo", revision: 1, characters: {}, locations: {} }, events: [event],
    recipientsByEventId: new Map([[event.id, ["player"]]]),
  });

  assert.equal(history.loadWorldState("demo")?.revision, 1);
  assert.deepEqual(history.listEventsByIds("demo", [event.id]), [event]);
  assert.deepEqual(history.getProcessedActionResult("persisted-action", "fingerprint"), {
    actionId: "persisted-action", events: [event], stateRevision: 1,
  });
  const snapshot = history.loadWorldState("demo")!;
  snapshot.revision = 99;
  assert.equal(history.loadWorldState("demo")?.revision, 1);

  await running.dispose();
  repository.close();
});

test("system persistence rejects feature plugins that request its commit port", async () => {
  const repository = new SqliteCifRepository();
  const eventTasks = new EventTaskRegistry();
  const persistence = createSqlitePersistenceSystem(repository, { eventTasks });
  const composition: GameComposition = {
    profileId: "persistence-access-test",
    plugins: [
      { plugin: createSqliteDurableJobsPlugin(repository, eventTasks) },
      { plugin: persistence.plugin },
      { plugin: {
        manifest: { id: "feature.illegal-writer", version: "1.0.0", configVersion: 1, requires: [SYSTEM_TURN_COMMITTER_CAPABILITY] },
        implementation: () => undefined,
      } },
    ],
  };
  await assert.rejects(bootstrap(new CordisPlatformAdapter(), composition), /may not require system-only capability/);
  repository.close();
});
