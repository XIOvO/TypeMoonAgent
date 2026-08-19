import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "../../core/contracts.js";
import type { CommandGateway } from "../../core/command-gateway.js";
import { GameRuntime } from "../../core/runtime.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import type { GameComposition } from "../../platform/contracts.js";
import { createRuntimeCommandAuthorityPlugin, WORLD_COMMAND_GATEWAY_CAPABILITY } from "./command-authority.js";
import { WorldStateStore } from "../../core/world-state.js";
import { createWorldStatePlugin } from "./world-state.js";
import { StateBackedWorldMap } from "../../core/world-map.js";
import { exitGraphNavigation } from "../../core/navigation.js";
import { createWorldMapPlugin } from "./world-map.js";
import { CommittedWorldNavigation, createWorldNavigationPlugin } from "./world-navigation.js";

test("system command-authority exposes Runtime only through the command gateway", async () => {
  const stateStore = new WorldStateStore(world());
  const navigation = new CommittedWorldNavigation(stateStore, exitGraphNavigation);
  const runtime = new GameRuntime(world(), {}, undefined, undefined, 0, undefined, undefined, navigation);
  const composition: GameComposition = {
    profileId: "command-authority-test", plugins: [
      { plugin: createWorldStatePlugin(stateStore) },
      { plugin: createWorldMapPlugin(new StateBackedWorldMap(stateStore)) },
      { plugin: createWorldNavigationPlugin(navigation) },
      { plugin: createRuntimeCommandAuthorityPlugin(runtime) },
    ],
  };
  const running = await bootstrap(new CordisPlatformAdapter(), composition);
  const gateway = running.get<CommandGateway>(WORLD_COMMAND_GATEWAY_CAPABILITY);
  const result = await gateway.handlePlayerAction({
    id: "move-through-gateway", sessionId: "demo", actorId: "player", type: "action", parameters: { intent: "move", destination: "cafeteria" },
  });
  assert.equal(result.events[0]?.type, "character_moved");
  assert.equal(gateway.getState().characters.player?.locationId, "cafeteria");
  await running.dispose();
});

function world(): GameState {
  return {
    sessionId: "demo", revision: 0,
    characters: { player: { id: "player", locationId: "hall", mood: "calm" } },
    locations: { hall: { id: "hall", exits: ["cafeteria"] }, cafeteria: { id: "cafeteria", exits: ["hall"] } },
  };
}
