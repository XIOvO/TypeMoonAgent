import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunner } from "../core/agent-runner.js";
import type { AgentAction, GameState, Observation } from "../core/contracts.js";
import type { StoryChapterPackage } from "../core/worldline.js";
import { GameRuntime } from "../core/runtime.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import { SqliteTurnCommitter } from "../persistence/turn-commit.js";
import { BranchWorldlineProjector } from "./branch-projector.js";
import { StaticStoryChapterCatalog, StoryChapterPackageService } from "./chapter-packages.js";
import { StorySummonScheduler, StorySummonWorker } from "./story-summon.js";
import { SqliteDurableJobQueue } from "../plugins/system/durable-jobs.js";

const state = (): GameState => ({
  sessionId: "demo", revision: 0, moment: { timelineId: "session:demo", tick: 0 },
  characters: { player: { id: "player", locationId: "hall", mood: "calm" }, mash: { id: "mash", locationId: "hall", mood: "calm" } },
  locations: { hall: { id: "hall", exits: [] } },
});

const chapter: StoryChapterPackage = {
  packageId: "test:opening:v1", contentType: "main", contentId: "opening", canonAnchor: "test:anchor", entryNodeId: "opening",
  sourceFragmentIds: [], version: 1,
  nodeRules: [{
    id: "opening", when: { type: "story_summon_opened" }, summon: { characterId: "mash", reason: "chapter_opening" },
    transition: { status: "active", activeNodeId: "play", completeNodeIds: ["opening"] },
  }],
};

class MashOpener implements AgentRunner {
  public async run(observation: Observation): Promise<AgentAction> {
    return { id: "mash-opening", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id, utterance: "前辈，任务已经开始了。", requests: [] };
  }
}

test("an entered chapter summons its configured opener and advances the same node", async () => {
  const repository = new SqliteCifRepository();
  const chapters = new StoryChapterPackageService(repository);
  const catalog = new StaticStoryChapterCatalog([chapter]);
  const worldline = new BranchWorldlineProjector(repository, chapters);
  worldline.initialize({ sessionId: "demo", playerId: "player", canonAnchor: "test:anchor", checkpointRevision: 0, updatedAt: "2026-08-15T00:00:00.000Z" });
  const jobs = new SqliteDurableJobQueue(repository);
  const scheduler = new StorySummonScheduler(repository, catalog, jobs);
  const runtime = new GameRuntime(state(), { mash: new MashOpener() }, new SqliteTurnCommitter(repository, undefined, worldline, scheduler), undefined, 0, chapters);
  await runtime.enterChapter({ id: "enter", sessionId: "demo", playerId: "player", mode: "new", chapter });
  const worker = new StorySummonWorker(jobs, repository, runtime);
  assert.equal(await worker.processNext("demo", new Date("2030-08-15T00:01:00.000Z")), true);
  assert.deepEqual(runtime.getEvents().map((event) => event.type), ["chapter_entered", "character_spoke", "story_summon_opened"]);
  assert.deepEqual(repository.getBranchProgress("demo", "player", "main", "opening"), {
    sessionId: "demo", playerId: "player", contentType: "main", contentId: "opening", activeNodeId: "play", status: "active",
    completedNodeIds: ["opening"], divertedNodeIds: [], blockedNodeIds: [], updatedAt: runtime.getEvents()[2]!.createdAt,
  });
  repository.close();
});
