import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "../../core/contracts.js";
import { exitGraphNavigation } from "../../core/navigation.js";
import { GameRuntime } from "../../core/runtime.js";
import { StateBackedWorldMap } from "../../core/world-map.js";
import { WorldStateStore, type WorldStateReader } from "../../core/world-state.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import type { GameComposition } from "../../platform/contracts.js";
import { WORLD_MAP_CAPABILITY, createWorldMapPlugin } from "./world-map.js";
import { CommittedWorldNavigation, WORLD_NAVIGATION_CAPABILITY, type WorldNavigation, createWorldNavigationPlugin } from "./world-navigation.js";
import { createWorldStatePlugin } from "./world-state.js";

test("world map and navigation expose the current committed exit graph with classified routes", async () => {
  const store = new WorldStateStore(world());
  const map = new StateBackedWorldMap(store);
  const navigation = new CommittedWorldNavigation(store, exitGraphNavigation);
  const composition: GameComposition = {
    profileId: "world-map-navigation-test",
    plugins: [
      { plugin: createWorldStatePlugin(store) },
      { plugin: createWorldMapPlugin(map) },
      { plugin: createWorldNavigationPlugin(navigation) },
    ],
  };
  const running = await bootstrap(new CordisPlatformAdapter(), composition);
  const providedMap = running.get<import("../../core/world-map.js").WorldMap>(WORLD_MAP_CAPABILITY);
  const providedNavigation = running.get<WorldNavigation>(WORLD_NAVIGATION_CAPABILITY);

  assert.deepEqual(providedMap.getConnectedLocationIds("hall"), ["cafeteria", "library"]);
  assert.deepEqual(providedNavigation.findRoute("hall", "archive"), { kind: "reachable", steps: ["library", "archive"] });
  assert.deepEqual(providedNavigation.findRoute("hall", "hall"), { kind: "already_there" });
  assert.deepEqual(providedNavigation.findRoute("hall", "missing"), { kind: "unreachable", reason: "unknown_destination" });
  store.publishCommittedState({ ...world(), locations: { hall: { id: "hall", exits: [] }, cafeteria: { id: "cafeteria", exits: [] }, library: { id: "library", exits: ["archive"] }, archive: { id: "archive", exits: [] } } });
  assert.deepEqual(providedNavigation.findRoute("hall", "archive"), { kind: "unreachable", reason: "no_route" });

  await running.dispose();
});

test("Runtime uses the navigation port and still approaches by one exit only", async () => {
  const state: GameState = {
    ...world(),
    characters: {
      player: { id: "player", locationId: "archive", mood: "calm" },
      mash: { id: "mash", locationId: "hall", mood: "alert" },
    },
  };
  const store = new WorldStateStore(state);
  const runtime = new GameRuntime(state, {}, undefined, undefined, 0, undefined, undefined,
    new CommittedWorldNavigation(store, exitGraphNavigation));

  await runtime.moveCharacterTowardPlayer({
    id: "navigation-port-approach", sessionId: "demo", playerId: "player", characterId: "mash",
    expectedPlayerLocationId: "archive", reason: "test",
  });

  assert.equal(runtime.getState().characters.mash.locationId, "library");
});

function world(): GameState {
  return {
    sessionId: "demo", revision: 0,
    characters: {},
    locations: {
      hall: { id: "hall", exits: ["library", "cafeteria"] },
      cafeteria: { id: "cafeteria", exits: [] },
      library: { id: "library", exits: ["archive"] },
      archive: { id: "archive", exits: [] },
    },
  };
}
