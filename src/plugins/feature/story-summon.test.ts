import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../../cif/sqlite-repository.js";
import type { AgentAction, GameEvent, GameState, Observation } from "../../core/contracts.js";
import { exitGraphNavigation } from "../../core/navigation.js";
import { GameRuntime } from "../../core/runtime.js";
import type { StoryChapterPackage } from "../../core/worldline.js";
import { StateBackedWorldMap } from "../../core/world-map.js";
import { WorldStateStore } from "../../core/world-state.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import type { GameComposition } from "../../platform/contracts.js";
import { StaticStoryChapterCatalog, StoryChapterPackageService } from "../../story/chapter-packages.js";
import { createRuntimeCommandAuthoritySystem } from "../system/command-authority.js";
import { EventTaskRegistry, SqliteDurableJobQueue, createSqliteDurableJobsPlugin } from "../system/durable-jobs.js";
import { createSqlitePersistenceSystem } from "../system/persistence.js";
import { createWorldMapPlugin } from "../system/world-map.js";
import { CommittedWorldNavigation, createWorldNavigationPlugin } from "../system/world-navigation.js";
import { createWorldStatePlugin } from "../system/world-state.js";
import { WORLD_STORY_CHAPTERS_CAPABILITY, createStoryChaptersPlugin, type StoryChapterController } from "./story-chapters.js";
import { WORLD_STORY_SUMMON_CAPABILITY, createStorySummonPlugin, type StorySummonController } from "./story-summon.js";

test("feature story-summon owns chapter jobs and removes its event scheduler on disposal", async () => {
  const repository = new SqliteCifRepository();
  const state = world();
  repository.saveWorldState(state, "2026-08-15T00:00:00.000Z");
  const tasks = new EventTaskRegistry();
  const jobs = new SqliteDurableJobQueue(repository);
  const persistence = createSqlitePersistenceSystem(repository, { eventTasks: tasks });
  const chapters = new StoryChapterPackageService(repository);
  const catalog = new StaticStoryChapterCatalog([chapter]);
  const store = new WorldStateStore(state);
  const navigation = new CommittedWorldNavigation(store, exitGraphNavigation);
  const runtime = new GameRuntime(state, { mash: { run: async (observation: Observation): Promise<AgentAction> => ({
    id: "mash-opening", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id,
    utterance: "前辈，剧情开始了。", requests: [],
  }) } }, persistence.turnCommitter, undefined, 0, chapters, store, navigation);
  const commands = createRuntimeCommandAuthoritySystem(runtime);
  const composition: GameComposition = {
    profileId: "story-summon-test",
    plugins: [
      { plugin: createSqliteDurableJobsPlugin(repository, tasks, jobs) },
      { plugin: persistence.plugin },
      { plugin: createWorldStatePlugin(store) },
      { plugin: createWorldMapPlugin(new StateBackedWorldMap(store)) },
      { plugin: createWorldNavigationPlugin(navigation) },
      { plugin: commands.plugin },
      { plugin: createStoryChaptersPlugin(chapters, catalog, commands.gateway) },
      { plugin: createStorySummonPlugin({ sessionId: "demo", jobs, chapters: repository, catalog, commands: commands.gateway, eventTasks: tasks, intervalMs: 1_000 }) },
    ],
  };
  const running = await bootstrap(new CordisPlatformAdapter(), composition);
  const story = running.get<StoryChapterController>(WORLD_STORY_CHAPTERS_CAPABILITY);
  const summon = running.get<StorySummonController>(WORLD_STORY_SUMMON_CAPABILITY);

  await story.enter({ id: "enter-opening", sessionId: "demo", playerId: "player", packageId: chapter.packageId, mode: "new" });
  await summon.drain("demo");
  assert.deepEqual(runtime.getEvents().map((event) => event.type), ["chapter_entered", "character_spoke", "story_summon_opened"]);

  await running.dispose();
  repository.transaction(() => tasks.schedule([chapterEntered("after-dispose", 4)]));
  assert.equal(jobs.claim({ sessionId: "demo", workerId: "test", kind: "story.summon", now: "2026-08-15T00:01:00.000Z", leaseExpiresBefore: "2026-08-14T23:56:00.000Z" }), undefined);
  repository.close();
});

const chapter: StoryChapterPackage = {
  packageId: "test:opening:v1", contentType: "main", contentId: "opening", canonAnchor: "test:anchor", entryNodeId: "opening", sourceFragmentIds: [], version: 1,
  nodeRules: [{ id: "opening", when: { type: "story_summon_opened" }, summon: { characterId: "mash", reason: "chapter_opening" }, transition: { status: "active", activeNodeId: "play", completeNodeIds: ["opening"] } }],
};

function world(): GameState {
  return { sessionId: "demo", revision: 1, moment: { timelineId: "session:demo", tick: 1 }, characters: { player: { id: "player", locationId: "hall", mood: "calm" }, mash: { id: "mash", locationId: "hall", mood: "calm" } }, locations: { hall: { id: "hall", exits: [] } } };
}

function chapterEntered(id: string, sequence: number): GameEvent {
  return { id, sessionId: "demo", sequence, createdAt: "2026-08-15T00:00:00.000Z", type: "chapter_entered", payload: { packageId: chapter.packageId }, causation: { playerActionId: id }, stateRevision: sequence, moment: { timelineId: "session:demo", tick: sequence } };
}
