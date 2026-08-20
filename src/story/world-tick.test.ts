import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { GameEvent, GameState } from "../core/contracts.js";
import { exitGraphNavigation } from "../core/navigation.js";
import { GameRuntime } from "../core/runtime.js";
import { SqliteTurnCommitter } from "../persistence/turn-commit.js";
import { PresentFreeCharacterWorldTickPlanner, WorldSimulationWorker, WorldTickScheduler, WorldTickWorker } from "./world-tick.js";
import { RuntimeWorldSimulationExecutor } from "./runtime-world-simulation-executor.js";
import { SqliteDurableJobQueue } from "../plugins/system/durable-jobs.js";

const world = (tick: number): GameState => ({
  sessionId: "demo", revision: tick, moment: { timelineId: "session:demo", tick },
  characters: { player: { id: "player", locationId: "hall", mood: "calm" }, mash: { id: "mash", locationId: "hall", mood: "calm" } },
  locations: { hall: { id: "hall", exits: [] } },
});

const waited = (id: string, tick: number): GameEvent => ({
  id, sessionId: "demo", createdAt: "2026-08-15T00:00:00.000Z", sequence: tick, type: "time_waited",
  payload: { characterId: "player", ticks: 1 }, causation: { playerActionId: `wait-${tick}` }, stateRevision: tick,
  moment: { timelineId: "session:demo", tick },
});

function jobs(repository: SqliteCifRepository): SqliteDurableJobQueue {
  return new SqliteDurableJobQueue(repository);
}

test("a confirmed wait schedules one durable world tick and deterministic simulation candidates", async () => {
  const repository = new SqliteCifRepository();
  repository.saveWorldState(world(1), "2026-08-15T00:00:00.000Z");
  const scheduler = new WorldTickScheduler(jobs(repository));
  repository.transaction(() => { scheduler.schedule([waited("wait-event", 1), waited("duplicate-event", 1)]); });
  const worker = new WorldTickWorker(jobs(repository), repository, { select: () => [{ actorId: "mash", reason: "present_in_scene" }, { actorId: "mash", reason: "duplicate" }] });
  assert.equal(await worker.processNext("demo", new Date("2026-08-15T00:01:00.000Z")), true);
  const simulation = repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "world.simulation", now: "2026-08-15T00:01:00.000Z", leaseExpiresBefore: "2026-08-14T23:56:00.000Z" });
  assert.deepEqual(simulation?.payload, { timelineId: "session:demo", tick: 1, sourceEventId: "wait-event", correlationId: "action:demo:wait-1", actorId: "mash", reason: "present_in_scene" });
  repository.close();
});

test("a stale tick is completed without creating late simulation work", async () => {
  const repository = new SqliteCifRepository();
  repository.saveWorldState(world(2), "2026-08-15T00:00:00.000Z");
  repository.transaction(() => new WorldTickScheduler(jobs(repository)).schedule([waited("old-wait", 1)]));
  const worker = new WorldTickWorker(jobs(repository), repository, { select: () => [{ actorId: "mash", reason: "must_not_run" }] });
  await worker.processNext("demo", new Date("2026-08-15T00:01:00.000Z"));
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "world.simulation", now: "2026-08-15T00:01:00.000Z", leaseExpiresBefore: "2026-08-14T23:56:00.000Z" }), undefined);
  repository.close();
});

test("present, free NPCs with a pending goal are selected in a stable bounded order", () => {
  const repository = new SqliteCifRepository();
  const state = world(1);
  state.characters.aster = { id: "aster", locationId: "hall", mood: "calm" };
  state.characters.busy = { id: "busy", locationId: "hall", mood: "calm" };
  state.characters.remote = { id: "remote", locationId: "elsewhere", mood: "calm" };
  state.characters.untracked = { id: "untracked", locationId: "hall", mood: "calm" };
  for (const [characterId, availability, activeGoals] of [["mash", "free", ["guard the hall"]], ["aster", "free", ["inspect the notice"]], ["busy", "busy", ["wait for orders"]], ["remote", "free", ["return later"]]] as const) {
    repository.saveRuntimeState({ sessionId: "demo", characterId, attention: [], emotions: [], activeGoals: [...activeGoals], availability, updatedAt: "2026-08-15T00:00:00.000Z" });
  }
  const planner = new PresentFreeCharacterWorldTickPlanner(repository, "player", 2);
  assert.deepEqual(planner.select({ sessionId: "demo", moment: { timelineId: "session:demo", tick: 1 }, sourceEventId: "wait", world: state }), [
    { actorId: "aster", reason: "active_goal" }, { actorId: "mash", reason: "active_goal" },
  ]);
  repository.close();
});

test("a proactive opener respects the persisted tick cooldown", () => {
  const repository = new SqliteCifRepository();
  const state = world(3);
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: [], emotions: [], activeGoals: ["guard the hall"], availability: "free", lastProactiveInteractionTick: 1, updatedAt: "2026-08-15T00:00:00.000Z" });
  const planner = new PresentFreeCharacterWorldTickPlanner(repository, "player", 1, 3);
  assert.deepEqual(planner.select({ sessionId: "demo", moment: { timelineId: "session:demo", tick: 3 }, sourceEventId: "wait", world: state }), []);
  state.moment = { timelineId: "session:demo", tick: 4 };
  assert.deepEqual(planner.select({ sessionId: "demo", moment: state.moment, sourceEventId: "wait", world: state }), [{ actorId: "mash", reason: "active_goal" }]);
  repository.close();
});

test("a remote character approaches only a currently known player location, one edge at a time", () => {
  const repository = new SqliteCifRepository();
  const state = world(1);
  state.characters.player.locationId = "destination";
  state.characters.mash.locationId = "origin";
  state.locations = { origin: { id: "origin", exits: ["middle"] }, middle: { id: "middle", exits: ["origin", "destination"] }, destination: { id: "destination", exits: ["middle"] } };
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: [], emotions: [], activeGoals: ["find the player"], availability: "free", approachPlayer: "when_safe", knownPlayerLocationId: "destination", updatedAt: "2026-08-15T00:00:00.000Z" });
  const planner = new PresentFreeCharacterWorldTickPlanner(repository, "player", 1);
  assert.deepEqual(planner.select({ sessionId: "demo", moment: { timelineId: "session:demo", tick: 1 }, sourceEventId: "wait", world: state }), [{ actorId: "mash", reason: "approach_player", targetLocationId: "destination" }]);
  repository.close();
});

test("present-scene policy pauses all simulation candidates during an active battle", () => {
  const repository = new SqliteCifRepository();
  const state = world(1);
  state.battle = { id: "battle", locationId: "hall", status: "active", turn: 1, objective: "hold", allies: {}, enemies: {} };
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: [], emotions: [], activeGoals: ["guard the hall"], availability: "free", updatedAt: "2026-08-15T00:00:00.000Z" });
  const planner = new PresentFreeCharacterWorldTickPlanner(repository, "player");
  assert.deepEqual(planner.select({ sessionId: "demo", moment: { timelineId: "session:demo", tick: 1 }, sourceEventId: "wait", world: state }), []);
  repository.close();
});

test("simulation worker consumes a current eligible candidate without creating autonomous events", async () => {
  const repository = new SqliteCifRepository();
  repository.saveWorldState(world(1), "2026-08-15T00:00:00.000Z");
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: [], emotions: [], activeGoals: ["guard the hall"], availability: "free", updatedAt: "2026-08-15T00:00:00.000Z" });
  repository.enqueueDurableJob({ id: "simulation", sessionId: "demo", kind: "world.simulation", dedupeKey: "session:demo:1:mash", payload: { timelineId: "session:demo", tick: 1, sourceEventId: "wait", actorId: "mash", reason: "active_goal" }, status: "pending", attempts: 0, maxAttempts: 3, availableAt: "2026-08-15T00:00:00.000Z", createdAt: "2026-08-15T00:00:00.000Z" });
  const calls: string[] = [];
  const worker = new WorldSimulationWorker(jobs(repository), repository, repository, "player", { execute: async (input) => { calls.push(input.actorId); } });
  assert.equal(await worker.processNext("demo", new Date("2026-08-15T00:01:00.000Z")), true);
  assert.deepEqual(calls, ["mash"]);
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "world.simulation", now: "2026-08-15T00:01:00.000Z", leaseExpiresBefore: "2026-08-14T23:56:00.000Z" }), undefined);
  repository.close();
});

test("simulation worker completes stale or no-longer-eligible candidates without executing", async () => {
  const repository = new SqliteCifRepository();
  repository.saveWorldState(world(2), "2026-08-15T00:00:00.000Z");
  repository.enqueueDurableJob({ id: "stale-simulation", sessionId: "demo", kind: "world.simulation", dedupeKey: "session:demo:1:mash", payload: { timelineId: "session:demo", tick: 1, sourceEventId: "wait", actorId: "mash", reason: "active_goal" }, status: "pending", attempts: 0, maxAttempts: 3, availableAt: "2026-08-15T00:00:00.000Z", createdAt: "2026-08-15T00:00:00.000Z" });
  const worker = new WorldSimulationWorker(jobs(repository), repository, repository, "player", { execute: async () => { throw new Error("must_not_execute"); } });
  assert.equal(await worker.processNext("demo", new Date("2026-08-15T00:01:00.000Z")), true);
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "world.simulation", now: "2026-08-15T00:01:00.000Z", leaseExpiresBefore: "2026-08-14T23:56:00.000Z" }), undefined);
  repository.close();
});

test("a successful proactive opener persists its cooldown after Runtime commits the speech", async () => {
  const repository = new SqliteCifRepository();
  repository.saveWorldState(world(1), "2026-08-15T00:00:00.000Z");
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: [], emotions: [], activeGoals: ["guard the hall"], availability: "free", updatedAt: "2026-08-15T00:00:00.000Z" });
  repository.enqueueDurableJob({ id: "proactive", sessionId: "demo", kind: "world.simulation", dedupeKey: "session:demo:1:mash", payload: { timelineId: "session:demo", tick: 1, sourceEventId: "wait", actorId: "mash", reason: "active_goal" }, status: "pending", attempts: 0, maxAttempts: 3, availableAt: "2026-08-15T00:00:00.000Z", createdAt: "2026-08-15T00:00:00.000Z" });
  const runtime = new GameRuntime(world(1), { mash: { run: async (observation) => ({ id: "proactive-aa", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id, utterance: "前辈，需要协助吗？", requests: [] }) } }, new SqliteTurnCommitter(repository));
  const worker = new WorldSimulationWorker(jobs(repository), repository, repository, "player", new RuntimeWorldSimulationExecutor(runtime, repository, "player"));
  await worker.processNext("demo", new Date("2026-08-15T00:01:00.000Z"));
  assert.equal(repository.getRuntimeState("demo", "mash")?.lastProactiveInteractionTick, 1);
  assert.equal(repository.countObjectiveHistory("demo"), 1);
  repository.close();
});

test("an approach candidate is discarded when the player leaves its known target location", async () => {
  const repository = new SqliteCifRepository();
  const state = world(1);
  state.characters.player.locationId = "new-place";
  state.characters.mash.locationId = "origin";
  state.locations = { origin: { id: "origin", exits: ["old-place"] }, "old-place": { id: "old-place", exits: ["origin", "new-place"] }, "new-place": { id: "new-place", exits: ["old-place"] } };
  repository.saveWorldState(state, "2026-08-15T00:00:00.000Z");
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: [], emotions: [], activeGoals: ["find the player"], availability: "free", approachPlayer: "when_safe", knownPlayerLocationId: "old-place", updatedAt: "2026-08-15T00:00:00.000Z" });
  repository.enqueueDurableJob({ id: "stale-approach", sessionId: "demo", kind: "world.simulation", dedupeKey: "session:demo:1:mash", payload: { timelineId: "session:demo", tick: 1, sourceEventId: "wait", actorId: "mash", reason: "approach_player", targetLocationId: "old-place" }, status: "pending", attempts: 0, maxAttempts: 3, availableAt: "2026-08-15T00:00:00.000Z", createdAt: "2026-08-15T00:00:00.000Z" });
  const worker = new WorldSimulationWorker(jobs(repository), repository, repository, "player", { execute: async () => { throw new Error("must_not_execute"); } });
  await worker.processNext("demo", new Date("2026-08-15T00:01:00.000Z"));
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "world.simulation", now: "2026-08-15T00:01:00.000Z", leaseExpiresBefore: "2026-08-14T23:56:00.000Z" }), undefined);
  repository.close();
});

test("a verified approach candidate commits exactly one Runtime movement edge", async () => {
  const repository = new SqliteCifRepository();
  const state = world(1);
  state.characters.player.locationId = "destination";
  state.characters.mash.locationId = "origin";
  state.locations = { origin: { id: "origin", exits: ["middle"] }, middle: { id: "middle", exits: ["origin", "destination"] }, destination: { id: "destination", exits: ["middle"] } };
  repository.saveWorldState(state, "2026-08-15T00:00:00.000Z");
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: [], emotions: [], activeGoals: ["find the player"], availability: "free", approachPlayer: "when_safe", knownPlayerLocationId: "destination", updatedAt: "2026-08-15T00:00:00.000Z" });
  repository.enqueueDurableJob({ id: "approach", sessionId: "demo", kind: "world.simulation", dedupeKey: "session:demo:1:mash", payload: { timelineId: "session:demo", tick: 1, sourceEventId: "wait", actorId: "mash", reason: "approach_player", targetLocationId: "destination" }, status: "pending", attempts: 0, maxAttempts: 3, availableAt: "2026-08-15T00:00:00.000Z", createdAt: "2026-08-15T00:00:00.000Z" });
  const runtime = new GameRuntime(state, {}, new SqliteTurnCommitter(repository), undefined, 0, undefined, undefined, exitGraphNavigation);
  const worker = new WorldSimulationWorker(jobs(repository), repository, repository, "player", new RuntimeWorldSimulationExecutor(runtime, repository, "player"));
  await worker.processNext("demo", new Date("2026-08-15T00:01:00.000Z"));
  assert.equal(runtime.getState().characters.mash.locationId, "middle");
  assert.equal(repository.loadWorldState("demo")?.characters.mash.locationId, "middle");
  repository.close();
});
