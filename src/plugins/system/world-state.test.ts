import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "../../core/contracts.js";
import { GameRuntime } from "../../core/runtime.js";
import { WorldStateStore, type WorldStateReader } from "../../core/world-state.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import type { GameComposition } from "../../platform/contracts.js";
import type { TurnCommitter } from "../../persistence/turn-commit.js";
import { WORLD_STATE_CAPABILITY, createWorldStatePlugin } from "./world-state.js";

test("system world-state exposes isolated snapshots after a successful Runtime turn", async () => {
  const store = new WorldStateStore(world());
  const running = await mount(store);
  const reader = running.get<WorldStateReader>(WORLD_STATE_CAPABILITY);
  const observed: string[] = [];
  reader.subscribe((state) => observed.push(state.characters.player.locationId));

  const runtime = new GameRuntime(world(), {}, undefined, undefined, 0, undefined, store);
  await runtime.handlePlayerAction({
    id: "world-state-move", sessionId: "demo", actorId: "player", type: "action",
    parameters: { intent: "move", destination: "cafeteria" },
  });

  const snapshot = reader.getSnapshot();
  assert.equal(snapshot.characters.player.locationId, "cafeteria");
  assert.deepEqual(observed, ["cafeteria"]);
  (snapshot.characters.player.locationId as string) = "hall";
  assert.equal(reader.getSnapshot().characters.player.locationId, "cafeteria");
  await running.dispose();
});

test("system world-state never publishes a Runtime turn whose commit fails", async () => {
  const store = new WorldStateStore(world());
  const runtime = new GameRuntime(world(), {}, { commit: () => { throw new Error("commit_failed"); } } satisfies TurnCommitter, undefined, 0, undefined, store);

  await assert.rejects(runtime.handlePlayerAction({
    id: "failed-world-state-move", sessionId: "demo", actorId: "player", type: "action",
    parameters: { intent: "move", destination: "cafeteria" },
  }), /commit_failed/);

  assert.equal(store.getSnapshot().characters.player.locationId, "hall");
});

test("disposing system world-state removes its observers", async () => {
  const store = new WorldStateStore(world());
  const running = await mount(store);
  const reader = running.get<WorldStateReader>(WORLD_STATE_CAPABILITY);
  let calls = 0;
  reader.subscribe(() => { calls += 1; });
  await running.dispose();
  store.publishCommittedState({ ...world(), revision: 1 });
  assert.equal(calls, 0);
});

async function mount(store: WorldStateStore) {
  const composition: GameComposition = {
    profileId: "world-state-test", plugins: [{ plugin: createWorldStatePlugin(store) }],
  };
  return bootstrap(new CordisPlatformAdapter(), composition);
}

function world(): GameState {
  return {
    sessionId: "demo", revision: 0,
    characters: { player: { id: "player", locationId: "hall", mood: "calm" } },
    locations: { hall: { id: "hall", exits: ["cafeteria"] }, cafeteria: { id: "cafeteria", exits: ["hall"] } },
  };
}
