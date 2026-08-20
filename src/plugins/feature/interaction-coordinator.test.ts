import assert from "node:assert/strict";
import test from "node:test";
import { Service, type Context } from "@deepseek-ai/cordis";
import { SqliteCifRepository } from "../../cif/sqlite-repository.js";
import type { AgentAction, GameEvent, GameState, Observation } from "../../core/contracts.js";
import type { InteractionCommandHandler } from "../../core/interaction-command-handler.js";
import { GameRuntime } from "../../core/runtime.js";
import { WorldStateStore } from "../../core/world-state.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter, type CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import type { GameComposition } from "../../platform/contracts.js";
import { createRuntimeCommandAuthoritySystem } from "../system/command-authority.js";
import { EventTaskRegistry, SqliteDurableJobQueue, createSqliteDurableJobsPlugin } from "../system/durable-jobs.js";
import { createSqlitePersistenceSystem } from "../system/persistence.js";
import {
  INTERACTION_EXECUTE_CAPABILITY,
  INTERACTION_COMMAND_HANDLER_CAPABILITY,
  INTERACTION_PLAN_CAPABILITY,
  WORLD_INTERACTION_COORDINATOR_CAPABILITY,
  DurableInteractionCommandHandler,
  createInteractionCoordinatorPlugin,
  type InteractionCoordinatorController,
  type InteractionExecuteController,
  type InteractionPlanController,
} from "./interaction-coordinator.js";

test("interaction plan and execute capabilities preserve the legacy coordinator facade", async () => {
  const repository = new SqliteCifRepository();
  const state = world();
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: ["player"], emotions: [], activeGoals: [], availability: "free", updatedAt: "2026-08-20T00:00:00.000Z" });
  const jobs = new SqliteDurableJobQueue(repository);
  const tasks = new EventTaskRegistry();
  const persistence = createSqlitePersistenceSystem(repository, { eventTasks: tasks });
  const states = new WorldStateStore(state);
  const handler = new DurableInteractionCommandHandler(repository, repository);
  const runtime = new GameRuntime(state, { mash: { run: async (observation: Observation): Promise<AgentAction> => ({ id: "reply", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id, utterance: "在。", requests: [] }) } }, persistence.turnCommitter, undefined, 0, undefined, undefined, undefined, handler);
  const commands = createRuntimeCommandAuthoritySystem(runtime);
  const interaction = createInteractionCoordinatorPlugin({ sessionId: "demo", playerId: "player", jobs, world: states, states: repository, store: repository, handler, commands: commands.gateway, eventTasks: tasks, intervalMs: 1_000 });
  const composition: GameComposition = {
    profileId: "interaction-capabilities",
    plugins: [
      { plugin: createSqliteDurableJobsPlugin(repository, tasks, jobs) },
      { plugin: persistence.plugin },
      { plugin: worldStatePlugin(states) },
      { plugin: navigationPlaceholder() },
      { plugin: sceneLifecyclePlaceholder() },
      { plugin: commands.plugin },
      { plugin: interaction },
    ],
  };
  const running = await bootstrap(new CordisPlatformAdapter(), composition);
  const plan = running.get<InteractionPlanController>(INTERACTION_PLAN_CAPABILITY);
  const execute = running.get<InteractionExecuteController>(INTERACTION_EXECUTE_CAPABILITY);
  const commandHandler = running.get<InteractionCommandHandler>(INTERACTION_COMMAND_HANDLER_CAPABILITY);
  const legacy = running.get<InteractionCoordinatorController>(WORLD_INTERACTION_COORDINATOR_CAPABILITY);

  repository.transaction(() => tasks.schedule([speech()]));
  assert.equal(await plan.drain("demo"), 1);
  assert.equal(repository.getInteractionPlanBySourceAction("demo", "action-1")?.leadCharacterId, "mash");
  assert.equal(await execute.processNext("demo"), false);
  assert.equal(await legacy.drain("demo"), 0);
  assert.equal(commandHandler.resolveTarget({ state, action: { id: "resolve", sessionId: "demo", actorId: "player", type: "dialogue", content: "你好" } }), "mash");

  await running.dispose();
  repository.close();
});

test("a replacement interaction command-handler capability keeps Runtime on its stable boundary", async () => {
  const repository = new SqliteCifRepository();
  const state = world();
  const jobs = new SqliteDurableJobQueue(repository);
  const tasks = new EventTaskRegistry();
  const persistence = createSqlitePersistenceSystem(repository, { eventTasks: tasks });
  const states = new WorldStateStore(state);
  let effects = 0;
  const replacement: InteractionCommandHandler = {
    resolveTarget: () => "mash",
    createExecutionCommitEffect: () => () => { effects += 1; },
  };
  const runtime = new GameRuntime(state, { mash: { run: async () => { throw new Error("replacement_handler_should_defer_agent"); } } }, persistence.turnCommitter, undefined, 0, undefined, undefined, undefined, replacement);
  const commands = createRuntimeCommandAuthoritySystem(runtime);
  const interaction = createInteractionCoordinatorPlugin({ sessionId: "demo", playerId: "player", jobs, world: states, states: repository, store: repository, handler: replacement, commands: commands.gateway, eventTasks: tasks, intervalMs: 1_000 });
  const running = await bootstrap(new CordisPlatformAdapter(), {
    profileId: "interaction-replacement",
    plugins: [
      { plugin: createSqliteDurableJobsPlugin(repository, tasks, jobs) },
      { plugin: persistence.plugin },
      { plugin: worldStatePlugin(states) },
      { plugin: navigationPlaceholder() },
      { plugin: sceneLifecyclePlaceholder() },
      { plugin: commands.plugin },
      { plugin: interaction },
    ],
  });

  const result = await commands.gateway.handlePlayerAction({ id: "replacement-dialogue", sessionId: "demo", actorId: "player", type: "dialogue", content: "你好" });
  assert.deepEqual(result.events.map((event) => event.type), ["player_spoke"]);
  assert.equal(effects, 1);
  assert.equal(running.get<InteractionCommandHandler>(INTERACTION_COMMAND_HANDLER_CAPABILITY).resolveTarget({ state, action: { id: "resolve-replacement", sessionId: "demo", actorId: "player", type: "dialogue", content: "你好" } }), "mash");

  await running.dispose();
  repository.close();
});

function world(): GameState {
  return { sessionId: "demo", revision: 0, characters: { player: { id: "player", locationId: "hall", mood: "calm" }, mash: { id: "mash", locationId: "hall", mood: "calm" } }, locations: { hall: { id: "hall", exits: [] } } };
}

function speech(): GameEvent {
  return { id: "speech-1", sessionId: "demo", sequence: 1, type: "player_spoke", payload: { characterId: "player", targetId: "mash", locationId: "hall", text: "你好" }, causation: { playerActionId: "action-1" }, stateRevision: 1, createdAt: "2026-08-20T00:00:00.000Z" };
}

function worldStatePlugin(store: WorldStateStore): CordisGamePluginDefinition {
  return { manifest: { id: "system.test-world-state", version: "1.0.0", configVersion: 1, provides: [{ id: "world.state", serviceKey: "worldState" }] }, implementation: (ctx: Context) => { class WorldStateService extends Service { public constructor() { super(ctx, "worldState"); } public getSnapshot() { return store.getSnapshot(); } } new WorldStateService(); } };
}

function sceneLifecyclePlaceholder(): CordisGamePluginDefinition {
  return { manifest: { id: "feature.test-scene-lifecycle", version: "1.0.0", configVersion: 1, provides: [{ id: "world.sceneLifecycle", serviceKey: "worldSceneLifecycle" }] }, implementation: (ctx: Context) => { class SceneLifecycleService extends Service { public constructor() { super(ctx, "worldSceneLifecycle"); } } new SceneLifecycleService(); } };
}

function navigationPlaceholder(): CordisGamePluginDefinition {
  return { manifest: { id: "system.test-navigation", version: "1.0.0", configVersion: 1, provides: [{ id: "world.navigation", serviceKey: "worldNavigation" }] }, implementation: (ctx: Context) => { class NavigationService extends Service { public constructor() { super(ctx, "worldNavigation"); } } new NavigationService(); } };
}
