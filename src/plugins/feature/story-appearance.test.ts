import assert from "node:assert/strict";
import test from "node:test";
import type { GameState } from "../../core/contracts.js";
import { exitGraphNavigation } from "../../core/navigation.js";
import { GameRuntime } from "../../core/runtime.js";
import { StateBackedWorldMap } from "../../core/world-map.js";
import { WorldStateStore } from "../../core/world-state.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import { chaldeaOpeningAvailability } from "../../story/availability.js";
import { createRuntimeCommandAuthoritySystem } from "../system/command-authority.js";
import { createWorldMapPlugin } from "../system/world-map.js";
import { CommittedWorldNavigation, createWorldNavigationPlugin } from "../system/world-navigation.js";
import { createWorldStatePlugin } from "../system/world-state.js";
import { STORY_APPEARANCE_CAPABILITY, createStoryAppearancePlugin, type StoryAppearanceController } from "./story-appearance.js";

test("feature story-appearance resolves a publication-aware introduction capability", async () => {
  const state = world();
  const store = new WorldStateStore(state);
  const runtime = new GameRuntime(state, {});
  const commands = createRuntimeCommandAuthoritySystem(runtime);
  let published = true;
  const appearance = createStoryAppearancePlugin({
    availability: chaldeaOpeningAvailability,
    publication: { hasPublishedInitialization: () => published },
    commands: commands.gateway,
  });
  const navigation = new CommittedWorldNavigation(store, exitGraphNavigation);
  const running = await bootstrap(new CordisPlatformAdapter(), {
    profileId: "story-appearance-test",
    plugins: [
      { plugin: createWorldStatePlugin(store) },
      { plugin: createWorldMapPlugin(new StateBackedWorldMap(store)) },
      { plugin: createWorldNavigationPlugin(navigation) },
      { plugin: commands.plugin },
      { plugin: appearance },
    ],
  });
  const controller = running.get<StoryAppearanceController>(STORY_APPEARANCE_CAPABILITY);
  const signal = { id: "opening-1", sessionId: "demo", storyPointId: "chaldea:arrival", type: "opening_confirmed" as const, actorId: "player" };
  const [recommendation] = controller.recommend(signal);
  assert.equal(recommendation?.characterId, "mash");

  published = false;
  assert.deepEqual(controller.recommend(signal), []);
  await assert.rejects(controller.introduce(signal, recommendation!), /story_recommendation_no_longer_available/);
  assert.equal(runtime.getState().characters.mash, undefined);

  published = true;
  await controller.introduce(signal, recommendation!);
  assert.equal(runtime.getState().characters.mash?.locationId, "chaldea_hall");
  await running.dispose();
});

function world(): GameState {
  return { sessionId: "demo", revision: 0, characters: { player: { id: "player", locationId: "chaldea_hall", mood: "calm" } }, locations: { chaldea_hall: { id: "chaldea_hall", exits: [] } } };
}
