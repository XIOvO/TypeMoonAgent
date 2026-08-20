import { randomUUID } from "node:crypto";
import type { DurableJob, DurableJobQueue, EventTaskScheduler } from "../core/durable-jobs.js";
import type { GameEvent } from "../core/contracts.js";
import type { CommandGateway } from "../core/command-gateway.js";
import type { BranchProgress, PersistedStoryChapterPackage, SessionStoryContext } from "../core/worldline.js";
import type { CommandResult } from "../protocol/command.js";
import { STORY_PROGRESS_CAPABILITY, type StoryCommand } from "../protocol/story-commands.js";
import type { StoryChapterCatalog } from "./chapter-packages.js";
import { StoryCommandDispatcher } from "./command-dispatcher.js";

/** Read-only chapter persistence needed by the summon scheduler and worker. */
export interface ActiveStoryChapterReader {
  getStoryContext(sessionId: string): SessionStoryContext | undefined;
  listActiveStoryChapterPackages(sessionId: string): PersistedStoryChapterPackage[];
  getBranchProgress(sessionId: string, playerId: string, contentType: string, contentId: string): BranchProgress | undefined;
}

/** Produces at most one durable summon attempt per active node and game tick. */
export class StorySummonScheduler implements EventTaskScheduler {
  public constructor(private readonly chapters: ActiveStoryChapterReader, private readonly catalog: StoryChapterCatalog, private readonly jobs: DurableJobQueue) {}

  public schedule(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === "chapter_entered") {
        const packageId = event.payload.packageId;
        if (typeof packageId !== "string") continue;
        const chapter = this.catalog.get(packageId);
        if (chapter) this.enqueue(event, chapter.packageId, chapter.entryNodeId, event.payload.playerId);
        continue;
      }
      if (event.type !== "time_waited") continue;
      const context = this.chapters.getStoryContext(event.sessionId);
      if (!context) continue;
      for (const chapter of this.chapters.listActiveStoryChapterPackages(event.sessionId)) {
        const progress = this.chapters.getBranchProgress(event.sessionId, context.playerId, chapter.contentType, chapter.contentId);
        if (progress?.status === "active" && progress.activeNodeId) this.enqueue(event, chapter.packageId, progress.activeNodeId, context.playerId);
      }
    }
  }

  private enqueue(event: GameEvent, packageId: string, nodeId: string, playerId: unknown): void {
    if (typeof playerId !== "string" || !event.moment) return;
    const chapter = this.catalog.get(packageId) ?? this.chapters.listActiveStoryChapterPackages(event.sessionId).find((item) => item.packageId === packageId);
    if (!chapter?.nodeRules.find((node) => node.id === nodeId)?.summon) return;
    this.jobs.enqueue({
      id: randomUUID(), sessionId: event.sessionId, kind: "story.summon", dedupeKey: `${packageId}:${nodeId}:${event.moment.tick}`,
      payload: { packageId, nodeId, playerId, sourceEventIds: [event.id] }, status: "pending", attempts: 0, maxAttempts: 3, availableAt: event.createdAt, createdAt: event.createdAt,
    });
  }
}

/** Feature-owned handler for one active chapter node's summon progression. */
export class StorySummonCommandHandler {
  public constructor(private readonly chapters: ActiveStoryChapterReader, private readonly commands: CommandGateway) {}

  public async execute(command: StoryCommand): Promise<CommandResult> {
    if (command.type !== STORY_PROGRESS_CAPABILITY) return { accepted: false, rejection: { code: "story.command_unsupported", details: { type: command.type } } };
    const { packageId, nodeId, playerId } = command.payload;
    const chapter = this.chapters.listActiveStoryChapterPackages(command.sessionId).find((item) => item.packageId === packageId);
    const context = this.chapters.getStoryContext(command.sessionId);
    const progress = chapter && context ? this.chapters.getBranchProgress(command.sessionId, playerId, chapter.contentType, chapter.contentId) : undefined;
    const node = chapter?.nodeRules.find((item) => item.id === nodeId);
    const summon = node?.summon;
    if (!chapter || !context || context.playerId !== playerId || progress?.status !== "active" || progress.activeNodeId !== nodeId || !summon) {
      return { accepted: false, rejection: { code: "story.progress_ineligible" } };
    }
    const world = this.commands.getState();
    const player = world.characters[playerId];
    const character = world.characters[summon.characterId];
    if (!player || !character || world.battle?.status === "active") return { accepted: false, rejection: { code: "story.progress_deferred" } };
    if (player.locationId !== character.locationId) {
      await this.commands.moveCharacterTowardPlayer({ id: `story-summon:move:${command.id}`, sessionId: command.sessionId, playerId, characterId: character.id, expectedPlayerLocationId: player.locationId, reason: summon.reason });
      return { accepted: true };
    }
    const result = await this.commands.runCharacterInitiative({ id: `story-summon:open:${command.id}`, sessionId: command.sessionId, playerId, characterId: character.id, reason: summon.reason, storySummon: { packageId: chapter.packageId, nodeId: node.id } });
    return result.events.some((event) => event.type === "story_summon_opened")
      ? { accepted: true }
      : { accepted: false, rejection: { code: "story.summon_no_opening" } };
  }
}

/** Resolves a durable summon attempt through the registered story.progress handler. */
export class StorySummonWorker {
  public constructor(private readonly jobs: DurableJobQueue, private readonly commands: StoryCommandDispatcher) {}

  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "story-summon-worker";
    const job = this.jobs.claim({ sessionId, workerId, kind: "story.summon", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString() });
    if (!job) return false;
    try {
      const input = summonInput(job);
      const result = await this.commands.execute({ id: job.id, sessionId, type: STORY_PROGRESS_CAPABILITY,
        payload: input, causation: { sourceEventId: input.sourceEventIds[0] }, correlationId: `story-summon:${job.id}` });
      if (result.accepted) this.jobs.complete(job.id, workerId, now.toISOString());
      else if (result.rejection?.code === "story.progress_deferred") return this.defer(job, workerId, now);
      else if (result.rejection?.code === "story.progress_ineligible") this.jobs.complete(job.id, workerId, now.toISOString());
      else this.jobs.retry(job.id, workerId, result.rejection?.code ?? "story_summon_failed", new Date(now.getTime() + 1_000).toISOString());
      return true;
    } catch (error) {
      this.jobs.retry(job.id, workerId, error instanceof Error ? error.message : "story_summon_failed", new Date(now.getTime() + 1_000).toISOString());
      return true;
    }
  }

  public async drain(sessionId: string): Promise<number> { let count = 0; while (await this.processNext(sessionId)) count += 1; return count; }
  private defer(job: DurableJob, workerId: string, now: Date): boolean { this.jobs.defer(job.id, workerId, new Date(now.getTime() + 30_000).toISOString()); return true; }
}

function summonInput(job: DurableJob): { packageId: string; nodeId: string; playerId: string; sourceEventIds: string[] } {
  const { packageId, nodeId, playerId, sourceEventIds } = job.payload;
  if (typeof packageId !== "string" || !packageId || typeof nodeId !== "string" || !nodeId || typeof playerId !== "string" || !playerId || !Array.isArray(sourceEventIds) || !sourceEventIds.every((id) => typeof id === "string" && id)) throw new Error("invalid_story_summon_job");
  return { packageId, nodeId, playerId, sourceEventIds };
}
