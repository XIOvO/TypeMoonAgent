import { Service, type Context } from "@deepseek-ai/cordis";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { BranchProgress, PersistedStoryChapterPackage, SessionStoryContext, StoryChapterPackage } from "../../core/worldline.js";
import type { StoryChapterController } from "../../core/story-chapters.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import type { StoryChapterCatalog } from "../../story/chapter-packages.js";

export const WORLD_STORY_CHAPTERS_CAPABILITY = "world.storyChapters";

export interface StoryChapterPersistence {
  resume(sessionId: string, playerId: string, packageId: string): PersistedStoryChapterPackage;
  getContext(sessionId: string, playerId: string): { context: SessionStoryContext; chapters: Array<{ package: PersistedStoryChapterPackage; progress?: BranchProgress }> } | undefined;
}

export type { StoryChapterController } from "../../core/story-chapters.js";

class DefaultStoryChapterController implements StoryChapterController {
  public constructor(private readonly persistence: StoryChapterPersistence, private readonly catalog: StoryChapterCatalog, private readonly commands: CommandGateway) {}
  public list() { return this.catalog.list(); }
  public getContext(sessionId: string, playerId: string) { return this.persistence.getContext(sessionId, playerId); }
  public async enter(input: Parameters<StoryChapterController["enter"]>[0]): Promise<void> {
    if (input.mode === "resume") { this.persistence.resume(input.sessionId, input.playerId, input.packageId); return; }
    const chapter = this.catalog.get(input.packageId);
    if (!chapter) throw new Error("unknown_chapter_package");
    await this.commands.enterChapter({ id: input.id, sessionId: input.sessionId, playerId: input.playerId, mode: input.mode, chapter });
  }
}

export function createStoryChapterController(
  persistence: StoryChapterPersistence,
  catalog: StoryChapterCatalog,
  commands: CommandGateway,
): StoryChapterController {
  return new DefaultStoryChapterController(persistence, catalog, commands);
}

class StoryChapterControllerService extends Service implements StoryChapterController {
  public constructor(ctx: Context, private readonly controller: StoryChapterController) { super(ctx, "worldStoryChapters"); }
  public list() { return this.controller.list(); }
  public getContext(sessionId: string, playerId: string) { return this.controller.getContext(sessionId, playerId); }
  public enter(input: Parameters<StoryChapterController["enter"]>[0]) { return this.controller.enter(input); }
}

export function createStoryChaptersPlugin(
  persistence: StoryChapterPersistence,
  catalog: StoryChapterCatalog,
  commands: CommandGateway,
): CordisGamePluginDefinition {
  const controller = createStoryChapterController(persistence, catalog, commands);
  return {
    manifest: {
      id: "feature.story-chapters",
      version: "1.0.0",
      configVersion: 1,
      requires: ["world.commandGateway"],
      provides: [{ id: WORLD_STORY_CHAPTERS_CAPABILITY, serviceKey: "worldStoryChapters" }],
    },
    implementation: (ctx: Context) => { new StoryChapterControllerService(ctx, controller); },
  };
}
