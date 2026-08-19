import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import { SqliteDurableJobQueue } from "../plugins/system/durable-jobs.js";
import { SceneLifecycleScheduler, SceneLifecycleWorker } from "./scene-lifecycle.js";
import type { GameEvent } from "./contracts.js";

test("scene lifecycle derives an interaction, then closes and opens scenes on confirmed player movement", async () => {
  const repository = new SqliteCifRepository();
  const jobs = new SqliteDurableJobQueue(repository);
  const scheduler = new SceneLifecycleScheduler(jobs, "player");
  scheduler.schedule([event("speak", 1, "player_spoke", { characterId: "player", locationId: "hall", text: "Hello" }, { playerActionId: "action-1" }), event("reply", 2, "character_spoke", { characterId: "mash", locationId: "hall", text: "Hello" }, { playerActionId: "action-1" })]);
  const worker = new SceneLifecycleWorker(jobs, repository);
  assert.equal(await worker.processNext("demo", new Date("2026-08-16T00:01:00.000Z")), true);
  assert.equal(await worker.processNext("demo", new Date("2026-08-16T00:01:00.000Z")), false);
  assert.deepEqual(repository.getSceneLifecycle("demo", "player"), { sessionId: "demo", playerId: "player", sceneId: "hall", phase: "active", openedAt: "2026-08-16T00:00:00.000Z", interactionCount: 1, lastInteractionId: "action-1", updatedAt: "2026-08-16T00:00:00.000Z" });
  scheduler.schedule([event("move", 3, "character_moved", { characterId: "player", from: "hall", to: "gate" }, { playerActionId: "action-2" })]);
  assert.equal(await worker.processNext("demo", new Date("2026-08-16T00:01:00.000Z")), true);
  assert.equal(repository.getSceneLifecycle("demo", "player")?.sceneId, "gate");
  assert.deepEqual([...repository.listSceneLifecycleEvents("demo", "player").map((item) => item.type).sort()], ["interaction_settled", "scene_closed", "scene_opened", "scene_opened"].sort());
  repository.close();
});

function event(id: string, sequence: number, type: GameEvent["type"], payload: Record<string, unknown>, causation: GameEvent["causation"]): GameEvent { return { id, sessionId: "demo", sequence, type, payload, causation, stateRevision: sequence, createdAt: "2026-08-16T00:00:00.000Z" }; }
