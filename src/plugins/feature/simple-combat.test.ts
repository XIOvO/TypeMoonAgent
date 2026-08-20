import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "../../core/contracts.js";
import { exitGraphNavigation } from "../../core/navigation.js";
import { GameRuntime } from "../../core/runtime.js";
import { StateBackedWorldMap } from "../../core/world-map.js";
import { WorldStateStore } from "../../core/world-state.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import { COMBAT_RESOLVE_CAPABILITY } from "../../protocol/combat-commands.js";
import { createRuntimeCommandAuthoritySystem } from "../system/command-authority.js";
import { createWorldMapPlugin } from "../system/world-map.js";
import { CommittedWorldNavigation, createWorldNavigationPlugin } from "../system/world-navigation.js";
import { createWorldStatePlugin } from "../system/world-state.js";
import { createDummyCombatPlugin } from "./dummy-combat.js";
import { createSimpleCombatPlugin, type CombatResolveController } from "./simple-combat.js";
import { SimpleCombatActionHandler } from "./simple-combat-rules.js";

test("SimpleCombatPlugin resolves combat.resolve through the existing deterministic battle lane", async () => {
  const state = world();
  const store = new WorldStateStore(state);
  const runtime = new GameRuntime(state, {}, undefined, undefined, 0, undefined, undefined, undefined, undefined, new SimpleCombatActionHandler());
  const commands = createRuntimeCommandAuthoritySystem(runtime);
  const navigation = new CommittedWorldNavigation(store, exitGraphNavigation);
  const running = await bootstrap(new CordisPlatformAdapter(), {
    profileId: "simple-combat-test",
    plugins: [
      { plugin: createWorldStatePlugin(store) },
      { plugin: createWorldMapPlugin(new StateBackedWorldMap(store)) },
      { plugin: createWorldNavigationPlugin(navigation) },
      { plugin: commands.plugin },
      { plugin: createSimpleCombatPlugin(commands.gateway) },
    ],
  });
  const combat = running.get<CombatResolveController>(COMBAT_RESOLVE_CAPABILITY);
  const result = await combat.execute({ id: "combat-attack", sessionId: "demo", actorId: "player", type: COMBAT_RESOLVE_CAPABILITY,
    payload: { participation: "command", commands: [{ actorId: "mash", intent: "attack", targetId: "skeleton" }] }, causation: {}, correlationId: "combat:test" });
  assert.deepEqual(result.events.map((event) => event.type), ["battle_round_resolved"]);
  assert.equal(runtime.getState().battle?.enemies.skeleton?.hp, 2);
  await running.dispose();
});

test("DummyCombatPlugin replaces combat.resolve without changing Kernel or Runtime", async () => {
  const state = world();
  const store = new WorldStateStore(state);
  const runtime = new GameRuntime(state, {});
  const commands = createRuntimeCommandAuthoritySystem(runtime);
  const navigation = new CommittedWorldNavigation(store, exitGraphNavigation);
  const running = await bootstrap(new CordisPlatformAdapter(), {
    profileId: "dummy-combat-swap-test",
    plugins: [
      { plugin: createWorldStatePlugin(store) },
      { plugin: createWorldMapPlugin(new StateBackedWorldMap(store)) },
      { plugin: createWorldNavigationPlugin(navigation) },
      { plugin: commands.plugin },
      { plugin: createDummyCombatPlugin(commands.gateway) },
    ],
  });
  const combat = running.get<CombatResolveController>(COMBAT_RESOLVE_CAPABILITY);
  const result = await combat.execute({ id: "dummy-combat-attack", sessionId: "demo", actorId: "player", type: COMBAT_RESOLVE_CAPABILITY,
    payload: { participation: "command", commands: [{ actorId: "mash", intent: "attack", targetId: "skeleton" }] }, causation: {}, correlationId: "combat:dummy" });
  assert.deepEqual(result, { actionId: "dummy-combat-attack", events: [], stateRevision: 0 });
  assert.equal(runtime.getState().battle?.enemies.skeleton?.hp, 3);
  await running.dispose();
});

test("Simple and Dummy combat providers swap under the same Kernel composition", async () => {
  const simple = await resolveWithProvider("simple");
  const dummy = await resolveWithProvider("dummy");
  assert.deepEqual(simple.result.events.map((event) => event.type), ["battle_round_resolved"]);
  assert.equal(simple.state.battle?.enemies.skeleton?.hp, 2);
  assert.deepEqual(dummy.result.events, []);
  assert.equal(dummy.state.battle?.enemies.skeleton?.hp, 3);
});

async function resolveWithProvider(provider: "simple" | "dummy") {
  const state = world();
  const store = new WorldStateStore(state);
  const runtime = combatKernel(state);
  const commands = createRuntimeCommandAuthoritySystem(runtime);
  const navigation = new CommittedWorldNavigation(store, exitGraphNavigation);
  const plugin = provider === "simple" ? createSimpleCombatPlugin(commands.gateway) : createDummyCombatPlugin(commands.gateway);
  const running = await bootstrap(new CordisPlatformAdapter(), {
    profileId: `combat-swap-${provider}`,
    plugins: [
      { plugin: createWorldStatePlugin(store) }, { plugin: createWorldMapPlugin(new StateBackedWorldMap(store)) },
      { plugin: createWorldNavigationPlugin(navigation) }, { plugin: commands.plugin }, { plugin },
    ],
  });
  try {
    const combat = running.get<CombatResolveController>(COMBAT_RESOLVE_CAPABILITY);
    const result = await combat.execute({ id: `swap-${provider}`, sessionId: "demo", actorId: "player", type: COMBAT_RESOLVE_CAPABILITY,
      payload: { participation: "command", commands: [{ actorId: "mash", intent: "attack", targetId: "skeleton" }] }, causation: {}, correlationId: `combat:swap:${provider}` });
    return { result, state: runtime.getState() };
  } finally {
    await running.dispose();
  }
}

function combatKernel(state: GameState): GameRuntime {
  return new GameRuntime(state, {}, undefined, undefined, 0, undefined, undefined, undefined, undefined, new SimpleCombatActionHandler());
}

function world(): GameState {
  return { sessionId: "demo", revision: 0, characters: { player: { id: "player", locationId: "hall", mood: "calm" }, mash: { id: "mash", locationId: "hall", mood: "alert" } }, locations: { hall: { id: "hall", exits: [] } }, battle: {
    id: "battle-1", locationId: "hall", status: "active", turn: 1, objective: "Hold the hall.",
    allies: { player: { id: "player", hp: 4, maxHp: 4, states: [] }, mash: { id: "mash", hp: 5, maxHp: 5, states: [] } },
    enemies: { skeleton: { id: "skeleton", hp: 3, maxHp: 3, states: [] } },
  } };
}
