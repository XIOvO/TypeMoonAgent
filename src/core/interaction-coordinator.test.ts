import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import { SqliteDurableJobQueue } from "../plugins/system/durable-jobs.js";
import type { GameEvent, GameState } from "./contracts.js";
import { InteractionCoordinatorScheduler, InteractionCoordinatorWorker } from "./interaction-coordinator.js";
import { WorldStateStore } from "./world-state.js";

test("interaction coordinator creates one explainable plan and never duplicates an action", async () => {
  const repository = new SqliteCifRepository();
  const state: GameState = { sessionId: "demo", revision: 0, characters: { player: { id: "player", locationId: "hall", mood: "calm" }, mash: { id: "mash", locationId: "hall", mood: "calm" }, aster: { id: "aster", locationId: "hall", mood: "calm" }, remote: { id: "remote", locationId: "gate", mood: "calm" } }, locations: { hall: { id: "hall", exits: [] }, gate: { id: "gate", exits: [] } } };
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: ["player"], emotions: [], activeGoals: ["protect"], availability: "free", updatedAt: "2026-08-16T00:00:00.000Z" });
  repository.saveRuntimeState({ sessionId: "demo", characterId: "aster", attention: [], emotions: [], activeGoals: [], availability: "free", updatedAt: "2026-08-16T00:00:00.000Z" });
  const jobs = new SqliteDurableJobQueue(repository); const scheduler = new InteractionCoordinatorScheduler(jobs, "player"); const event = speech("talk", "action-1");
  scheduler.schedule([event, event]);
  const worker = new InteractionCoordinatorWorker(jobs, new WorldStateStore(state), repository, repository);
  assert.equal(await worker.processNext("demo", new Date("2026-08-16T00:01:00.000Z")), true);
  assert.equal(await worker.processNext("demo", new Date("2026-08-16T00:01:00.000Z")), false);
  const plan = repository.getInteractionPlanBySourceAction("demo", "action-1");
  assert.equal(plan?.leadCharacterId, "mash");
  assert.deepEqual(plan?.participants, [{ characterId: "mash", role: "lead", reasons: ["player_addressed", "present_and_free"] }, { characterId: "aster", role: "support_candidate", reasons: ["present_and_free"] }]);
  repository.close();
});

function speech(id: string, actionId: string): GameEvent { return { id, sessionId: "demo", sequence: 1, type: "player_spoke", payload: { characterId: "player", targetId: "mash", locationId: "hall", text: "Hello" }, causation: { playerActionId: actionId }, stateRevision: 1, createdAt: "2026-08-16T00:00:00.000Z" }; }
