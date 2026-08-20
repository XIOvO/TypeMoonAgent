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
import { createSimpleCombatPlugin, type CombatResolveController } from "./simple-combat.js";

test("SimpleCombatPlugin resolves combat.resolve through the existing deterministic battle lane", async () => {
  const state = world();
  const store = new WorldStateStore(state);
  const runtime = new GameRuntime(state, {});
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

function world(): GameState {
  return { sessionId: "demo", revision: 0, characters: { player: { id: "player", locationId: "hall", mood: "calm" }, mash: { id: "mash", locationId: "hall", mood: "alert" } }, locations: { hall: { id: "hall", exits: [] } }, battle: {
    id: "battle-1", locationId: "hall", status: "active", turn: 1, objective: "Hold the hall.",
    allies: { player: { id: "player", hp: 4, maxHp: 4, states: [] }, mash: { id: "mash", hp: 5, maxHp: 5, states: [] } },
    enemies: { skeleton: { id: "skeleton", hp: 3, maxHp: 3, states: [] } },
  } };
}
