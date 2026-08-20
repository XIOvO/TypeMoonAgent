import { Service, type Context } from "@deepseek-ai/cordis";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { DurableJobQueue, EventTaskScheduler } from "../../core/durable-jobs.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import { STORY_PROGRESS_CAPABILITY } from "../../protocol/story-commands.js";
import type { StoryChapterCatalog } from "../../story/chapter-packages.js";
import { StoryCommandDispatcher } from "../../story/command-dispatcher.js";
import { StorySummonCommandHandler, StorySummonScheduler, StorySummonWorker, type ActiveStoryChapterReader } from "../../story/story-summon.js";
import { WORLD_STORY_CHAPTERS_CAPABILITY } from "./story-chapters.js";

export const WORLD_STORY_SUMMON_CAPABILITY = "world.storySummon";
export interface StorySummonController { drain(sessionId: string): Promise<number>; }
export interface StoryProgressController { execute(command: Parameters<StoryCommandDispatcher["execute"]>[0]): ReturnType<StoryCommandDispatcher["execute"]>; }

export interface StorySummonPluginDependencies {
  sessionId: string;
  jobs: DurableJobQueue;
  chapters: ActiveStoryChapterReader;
  catalog: StoryChapterCatalog;
  commands: CommandGateway;
  eventTasks: { register(scheduler: EventTaskScheduler): () => void };
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

class StorySummonControllerService extends Service implements StorySummonController {
  public constructor(ctx: Context, private readonly controller: StorySummonController) { super(ctx, "worldStorySummon"); }
  public drain(sessionId: string) { return this.controller.drain(sessionId); }
}
class StoryProgressService extends Service implements StoryProgressController { public constructor(ctx: Context, private readonly commands: StoryCommandDispatcher) { super(ctx, "storyProgress"); } public execute(command: Parameters<StoryCommandDispatcher["execute"]>[0]) { return this.commands.execute(command); } }

/** Owns durable chapter-opening attempts; actual movement and speech use commands. */
export function createStorySummonPlugin(dependencies: StorySummonPluginDependencies): CordisGamePluginDefinition {
  const scheduler = new StorySummonScheduler(dependencies.chapters, dependencies.catalog, dependencies.jobs);
  const progress = new StorySummonCommandHandler(dependencies.chapters, dependencies.commands);
  const commands = new StoryCommandDispatcher({ [STORY_PROGRESS_CAPABILITY]: (command) => progress.execute(command) });
  const worker = new StorySummonWorker(dependencies.jobs, commands);
  const controller: StorySummonController = { drain: (sessionId) => worker.drain(sessionId) };
  const report = dependencies.onError ?? ((error: unknown) => console.error("story summon failed", error));
  const intervalMs = dependencies.intervalMs ?? 30_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error("story_summon_interval_invalid");
  return {
    manifest: {
      id: "feature.story-summon",
      version: "1.1.0",
      configVersion: 1,
      requires: ["world.jobs", "world.eventTasks", "world.commandGateway", WORLD_STORY_CHAPTERS_CAPABILITY],
      provides: [{ id: WORLD_STORY_SUMMON_CAPABILITY, serviceKey: "worldStorySummon" }, { id: STORY_PROGRESS_CAPABILITY, serviceKey: "storyProgress" }],
      ownsJobs: ["story.summon"],
    },
    implementation: (ctx: Context) => {
      new StorySummonControllerService(ctx, controller);
      new StoryProgressService(ctx, commands);
      ctx.effect(() => {
        const unregister = dependencies.eventTasks.register(scheduler);
        const wake = () => { void controller.drain(dependencies.sessionId).catch(report); };
        const unsubscribe = dependencies.commands.subscribe((event) => { if (event.type === "chapter_entered" || event.type === "time_waited") wake(); });
        wake();
        const interval = setInterval(wake, intervalMs);
        interval.unref();
        return () => { unregister(); unsubscribe(); clearInterval(interval); };
      });
    },
  };
}
