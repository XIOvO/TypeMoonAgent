import { randomUUID } from "node:crypto";
import type { DurableJob, DurableJobQueue, EventTaskScheduler } from "../core/durable-jobs.js";
import type { GameEvent } from "../core/contracts.js";
import type { CommandGateway } from "../core/command-gateway.js";
import type { BranchProgress, PersistedStoryChapterPackage, SessionStoryContext } from "../core/worldline.js";
import type { StoryChapterCatalog } from "./chapter-packages.js";

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
      payload: { packageId, nodeId, playerId }, status: "pending", attempts: 0, maxAttempts: 3, availableAt: event.createdAt, createdAt: event.createdAt,
    });
  }
}

/** Resolves a configured opening through ordinary Runtime movement or speech. */
export class StorySummonWorker {
  public constructor(private readonly jobs: DurableJobQueue, private readonly chapters: ActiveStoryChapterReader, private readonly commands: CommandGateway) {}

  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "story-summon-worker";
    const job = this.jobs.claim({ sessionId, workerId, kind: "story.summon", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString() });
    if (!job) return false;
    try {
      const input = summonInput(job);
      const chapter = this.chapters.listActiveStoryChapterPackages(sessionId).find((item) => item.packageId === input.packageId);
      const context = this.chapters.getStoryContext(sessionId);
      const progress = chapter && context ? this.chapters.getBranchProgress(sessionId, input.playerId, chapter.contentType, chapter.contentId) : undefined;
      const node = chapter?.nodeRules.find((item) => item.id === input.nodeId);
      const summon = node?.summon;
      if (!chapter || !context || context.playerId !== input.playerId || progress?.status !== "active" || progress.activeNodeId !== input.nodeId || !summon) {
        this.jobs.complete(job.id, workerId, now.toISOString()); return true;
      }
      const world = this.commands.getState();
      const player = world.characters[input.playerId];
      const character = world.characters[summon.characterId];
      if (!player || !character || world.battle?.status === "active") return this.defer(job, workerId, now);
      if (player.locationId !== character.locationId) {
        await this.commands.moveCharacterTowardPlayer({ id: `story-summon:move:${job.id}`, sessionId, playerId: input.playerId, characterId: character.id, expectedPlayerLocationId: player.locationId, reason: summon.reason });
        this.jobs.complete(job.id, workerId, now.toISOString()); return true;
      }
      const result = await this.commands.runCharacterInitiative({ id: `story-summon:open:${job.id}`, sessionId, playerId: input.playerId, characterId: character.id, reason: summon.reason, storySummon: { packageId: chapter.packageId, nodeId: node.id } });
      if (result.events.some((event) => event.type === "story_summon_opened")) this.jobs.complete(job.id, workerId, now.toISOString());
      else this.jobs.retry(job.id, workerId, "story_summon_no_opening", new Date(now.getTime() + 1_000).toISOString());
      return true;
    } catch (error) {
      this.jobs.retry(job.id, workerId, error instanceof Error ? error.message : "story_summon_failed", new Date(now.getTime() + 1_000).toISOString());
      return true;
    }
  }

  public async drain(sessionId: string): Promise<number> { let count = 0; while (await this.processNext(sessionId)) count += 1; return count; }
  private defer(job: DurableJob, workerId: string, now: Date): boolean { this.jobs.defer(job.id, workerId, new Date(now.getTime() + 30_000).toISOString()); return true; }
}

function summonInput(job: DurableJob): { packageId: string; nodeId: string; playerId: string } {
  const { packageId, nodeId, playerId } = job.payload;
  if (typeof packageId !== "string" || !packageId || typeof nodeId !== "string" || !nodeId || typeof playerId !== "string" || !playerId) throw new Error("invalid_story_summon_job");
  return { packageId, nodeId, playerId };
}
