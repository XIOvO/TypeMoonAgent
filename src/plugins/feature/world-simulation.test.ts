import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../../cif/sqlite-repository.js";
import type { AgentAction, GameEvent, GameState, Observation } from "../../core/contracts.js";
import { exitGraphNavigation } from "../../core/navigation.js";
import { GameRuntime } from "../../core/runtime.js";
import { StateBackedWorldMap } from "../../core/world-map.js";
import { WorldStateStore } from "../../core/world-state.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import type { GameComposition } from "../../platform/contracts.js";
import { createRuntimeCommandAuthoritySystem } from "../system/command-authority.js";
import { EventTaskRegistry, SqliteDurableJobQueue, createSqliteDurableJobsPlugin } from "../system/durable-jobs.js";
import { createSqlitePersistenceSystem } from "../system/persistence.js";
import { createWorldMapPlugin } from "../system/world-map.js";
import { CommittedWorldNavigation, createWorldNavigationPlugin } from "../system/world-navigation.js";
import { createWorldStatePlugin } from "../system/world-state.js";
import { WORLD_SIMULATION_CAPABILITY, createWorldSimulationPlugin, type WorldSimulationController } from "./world-simulation.js";

test("feature world-simulation owns durable NPC work and unregisters on disposal", async () => {
  const repository = new SqliteCifRepository();
  const state = world();
  repository.saveWorldState(state, "2026-08-15T00:00:00.000Z");
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: [], emotions: [], activeGoals: ["guard the hall"], availability: "free", updatedAt: "2026-08-15T00:00:00.000Z" });
  const jobs = new SqliteDurableJobQueue(repository);
  const tasks = new EventTaskRegistry();
  const persistence = createSqlitePersistenceSystem(repository, { eventTasks: tasks });
  const store = new WorldStateStore(state);
  const navigation = new CommittedWorldNavigation(store, exitGraphNavigation);
  const runtime = new GameRuntime(state, { mash: { run: async (observation: Observation): Promise<AgentAction> => ({
    id: "mash-proactive", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id, utterance: "前辈，我在这里。", requests: [],
  }) } }, persistence.turnCommitter, undefined, 0, undefined, store, navigation);
  const commands = createRuntimeCommandAuthoritySystem(runtime);
  const simulation = createWorldSimulationPlugin({
    sessionId: "demo", playerId: "player", jobs, history: persistence.history, states: repository,
    commands: commands.gateway, navigation, eventTasks: tasks, intervalMs: 1_000,
  });
  const composition: GameComposition = {
    profileId: "world-simulation-test",
    plugins: [
      { plugin: createSqliteDurableJobsPlugin(repository, tasks, jobs) },
      { plugin: persistence.plugin },
      { plugin: createWorldStatePlugin(store) },
      { plugin: createWorldMapPlugin(new StateBackedWorldMap(store)) },
      { plugin: createWorldNavigationPlugin(navigation) },
      { plugin: commands.plugin },
      { plugin: simulation },
    ],
  };
  const running = await bootstrap(new CordisPlatformAdapter(), composition);
  const controller = running.get<WorldSimulationController>(WORLD_SIMULATION_CAPABILITY);

  repository.transaction(() => tasks.schedule([waited("wait-1", 1)]));
  await controller.drain("demo");
  assert.equal(repository.countObjectiveHistory("demo"), 1);
  assert.equal(repository.getRuntimeState("demo", "mash")?.lastProactiveInteractionTick, 1);

  await running.dispose();
  repository.transaction(() => tasks.schedule([waited("wait-2", 2)]));
  assert.equal(jobs.claim({ sessionId: "demo", workerId: "test", kind: "world.tick", now: "2026-08-15T00:01:00.000Z", leaseExpiresBefore: "2026-08-14T23:56:00.000Z" }), undefined);
  repository.close();
});

function world(): GameState {
  return {
    sessionId: "demo", revision: 1, moment: { timelineId: "session:demo", tick: 1 },
    characters: {
      player: { id: "player", locationId: "hall", mood: "calm" },
      mash: { id: "mash", locationId: "hall", mood: "calm" },
    },
    locations: { hall: { id: "hall", exits: [] } },
  };
}

function waited(id: string, tick: number): GameEvent {
  return {
    id, sessionId: "demo", sequence: tick, createdAt: "2026-08-15T00:00:00.000Z", type: "time_waited",
    payload: { characterId: "player", ticks: 1 }, causation: { playerActionId: id }, stateRevision: tick,
    moment: { timelineId: "session:demo", tick },
  };
}
