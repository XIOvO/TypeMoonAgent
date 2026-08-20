import { Service, type Context } from "@deepseek-ai/cordis";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { BranchProgress, PersistedStoryChapterPackage, SessionStoryContext, StoryChapterPackage } from "../../core/worldline.js";
import type { StoryChapterController } from "../../core/story-chapters.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import type { CommandResult } from "../../protocol/command.js";
import { STORY_ENTER_CAPABILITY, type StoryCommand } from "../../protocol/story-commands.js";
import type { StoryChapterCatalog } from "../../story/chapter-packages.js";
import { StoryCommandDispatcher } from "../../story/command-dispatcher.js";

export const WORLD_STORY_CHAPTERS_CAPABILITY = "world.storyChapters";

export interface StoryChapterPersistence {
  resume(sessionId: string, playerId: string, packageId: string): PersistedStoryChapterPackage;
  getContext(sessionId: string, playerId: string): { context: SessionStoryContext; chapters: Array<{ package: PersistedStoryChapterPackage; progress?: BranchProgress }> } | undefined;
}

export type { StoryChapterController } from "../../core/story-chapters.js";

export class StoryEnterCommandHandler {
  public constructor(private readonly persistence: StoryChapterPersistence, private readonly catalog: StoryChapterCatalog, private readonly commands: CommandGateway) {}
  public async execute(command: StoryCommand): Promise<CommandResult> {
    if (command.type !== STORY_ENTER_CAPABILITY) return { accepted: false, rejection: { code: "story.command_unsupported", details: { type: command.type } } };
    const input = command.payload;
    if (input.mode === "resume") { this.persistence.resume(command.sessionId, input.playerId, input.packageId); return { accepted: true }; }
    const chapter = this.catalog.get(input.packageId);
    if (!chapter) return { accepted: false, rejection: { code: "story.chapter_not_found", details: { packageId: input.packageId } } };
    await this.commands.enterChapter({ id: command.id, sessionId: command.sessionId, playerId: input.playerId, mode: input.mode, chapter });
    return { accepted: true };
  }
}

class DefaultStoryChapterController implements StoryChapterController {
  public constructor(private readonly persistence: StoryChapterPersistence, private readonly catalog: StoryChapterCatalog, private readonly commands: StoryCommandDispatcher) {}
  public list() { return this.catalog.list(); }
  public getContext(sessionId: string, playerId: string) { return this.persistence.getContext(sessionId, playerId); }
  public async enter(input: Parameters<StoryChapterController["enter"]>[0]): Promise<void> {
    const result = await this.commands.execute({ id: input.id, sessionId: input.sessionId, type: STORY_ENTER_CAPABILITY,
      payload: { playerId: input.playerId, packageId: input.packageId, mode: input.mode }, causation: {}, correlationId: `story-enter:${input.id}` });
    if (!result.accepted) throw new Error(result.rejection?.code ?? "story_command_rejected");
  }
}

export function createStoryChapterController(
  persistence: StoryChapterPersistence,
  catalog: StoryChapterCatalog,
  commands: CommandGateway,
  storyCommands = createStoryChapterCommandDispatcher(persistence, catalog, commands),
): StoryChapterController {
  return new DefaultStoryChapterController(persistence, catalog, storyCommands);
}

export function createStoryChapterCommandDispatcher(persistence: StoryChapterPersistence, catalog: StoryChapterCatalog, commands: CommandGateway): StoryCommandDispatcher {
  const enter = new StoryEnterCommandHandler(persistence, catalog, commands);
  return new StoryCommandDispatcher({ [STORY_ENTER_CAPABILITY]: (command) => enter.execute(command) });
}

class StoryChapterControllerService extends Service implements StoryChapterController {
  public constructor(ctx: Context, private readonly controller: StoryChapterController) { super(ctx, "worldStoryChapters"); }
  public list() { return this.controller.list(); }
  public getContext(sessionId: string, playerId: string) { return this.controller.getContext(sessionId, playerId); }
  public enter(input: Parameters<StoryChapterController["enter"]>[0]) { return this.controller.enter(input); }
}
export interface StoryEnterController { execute(command: Parameters<StoryCommandDispatcher["execute"]>[0]): ReturnType<StoryCommandDispatcher["execute"]>; }
class StoryEnterService extends Service implements StoryEnterController { public constructor(ctx: Context, private readonly commands: StoryCommandDispatcher) { super(ctx, "storyEnter"); } public execute(command: Parameters<StoryCommandDispatcher["execute"]>[0]) { return this.commands.execute(command); } }

export function createStoryChaptersPlugin(
  persistence: StoryChapterPersistence,
  catalog: StoryChapterCatalog,
  commands: CommandGateway,
): CordisGamePluginDefinition {
  const storyCommands = createStoryChapterCommandDispatcher(persistence, catalog, commands);
  const controller = createStoryChapterController(persistence, catalog, commands, storyCommands);
  return {
    manifest: {
      id: "feature.story-chapters",
      version: "1.1.0",
      configVersion: 1,
      requires: ["world.commandGateway"],
      provides: [{ id: WORLD_STORY_CHAPTERS_CAPABILITY, serviceKey: "worldStoryChapters" }, { id: STORY_ENTER_CAPABILITY, serviceKey: "storyEnter" }],
    },
    implementation: (ctx: Context) => { new StoryChapterControllerService(ctx, controller); new StoryEnterService(ctx, storyCommands); },
  };
}
