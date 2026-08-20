import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "../../core/contracts.js";
import { exitGraphNavigation } from "../../core/navigation.js";
import { GameRuntime } from "../../core/runtime.js";
import { StateBackedWorldMap } from "../../core/world-map.js";
import { WorldStateStore } from "../../core/world-state.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import { NAVIGATION_MOVE_CAPABILITY } from "../../protocol/navigation-commands.js";
import { createRuntimeCommandAuthoritySystem } from "../system/command-authority.js";
import { createWorldMapPlugin } from "../system/world-map.js";
import { CommittedWorldNavigation, createWorldNavigationPlugin } from "../system/world-navigation.js";
import { createWorldStatePlugin } from "../system/world-state.js";
import { createPlayerNavigationPlugin, type NavigationMoveController } from "./player-navigation.js";

test("PlayerNavigationPlugin moves through exactly one legal exit", async () => {
  const state: GameState = { sessionId: "demo", revision: 0, characters: { player: { id: "player", locationId: "hall", mood: "calm" } }, locations: { hall: { id: "hall", exits: ["cafeteria"] }, cafeteria: { id: "cafeteria", exits: ["hall", "garden"] }, garden: { id: "garden", exits: ["cafeteria"] } } };
  const store = new WorldStateStore(state);
  const runtime = new GameRuntime(state, {});
  const commands = createRuntimeCommandAuthoritySystem(runtime);
  const navigation = new CommittedWorldNavigation(store, exitGraphNavigation);
  const running = await bootstrap(new CordisPlatformAdapter(), { profileId: "player-navigation-test", plugins: [
    { plugin: createWorldStatePlugin(store) },
    { plugin: createWorldMapPlugin(new StateBackedWorldMap(store)) },
    { plugin: createWorldNavigationPlugin(navigation) },
    { plugin: commands.plugin },
    { plugin: createPlayerNavigationPlugin(commands.gateway) },
  ] });
  const moves = running.get<NavigationMoveController>(NAVIGATION_MOVE_CAPABILITY);
  const result = await moves.execute({ id: "move-player", sessionId: "demo", actorId: "player", type: NAVIGATION_MOVE_CAPABILITY, payload: { destination: "cafeteria" }, causation: {}, correlationId: "navigation:move-player" });
  assert.deepEqual(result.events.map((event) => event.type), ["character_moved"]);
  assert.deepEqual(result.events[0]?.payload, { characterId: "player", from: "hall", to: "cafeteria" });
  assert.equal(runtime.getState().characters.player.locationId, "cafeteria");
  await running.dispose();
});
