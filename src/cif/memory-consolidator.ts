import { CharacterMemoryService, type CharacterMemoryStore } from "./memory-service.js";
import type { EpisodeMemory, MemoryConsolidationTask, SceneNarrativeProjection } from "./types.js";
import type { DurableJob, DurableJobQueue } from "../core/durable-jobs.js";
import { randomUUID } from "node:crypto";

export interface MemoryConsolidationProposal {
  shouldRemember: boolean;
  summary?: string;
  subjectiveInterpretation?: string;
  emotions?: EpisodeMemory["emotions"];
  salience?: number;
  publicSummary?: string;
  openThreads?: string[];
  storyPressures?: string[];
}

export interface MemoryConsolidationGenerator {
  generate(task: MemoryConsolidationTask, evidence: Array<{ id: string; content: string; sourceEventIds: string[] }>): Promise<MemoryConsolidationProposal>;
}

/** Narrow persistence port; the worker never receives a general CIF repository. */
export interface MemoryConsolidationStore extends CharacterMemoryStore {
  saveSceneNarrativeProjection(projection: SceneNarrativeProjection): void;
}

/** Drains durable, Runtime-triggered jobs outside the turn transaction. */
export class MemoryConsolidationWorker {
  private readonly memories: CharacterMemoryService;

  public constructor(
    private readonly jobs: DurableJobQueue,
    private readonly store: MemoryConsolidationStore,
    private readonly generator: MemoryConsolidationGenerator,
  ) {
    this.memories = new CharacterMemoryService(store);
  }

  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "memory-l1-worker";
    const job = this.jobs.claim({
      sessionId, workerId, kind: "memory.l1", now: now.toISOString(),
      leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString(),
    });
    if (!job) return false;
    const task = memoryTaskFromJob(job);
    try {
      const evidence = this.store.listEvidenceByIds(task.sessionId, task.characterId, task.sourceEvidenceIds);
      const proposal = await this.generator.generate(task, evidence);
      const completedAt = new Date().toISOString();
      this.jobs.transaction(() => {
        if (proposal.shouldRemember && proposal.summary?.trim()) {
          const episode = this.memories.consolidateInTransaction({
            sessionId: task.sessionId, characterId: task.characterId, sourceEvidenceIds: task.sourceEvidenceIds,
            summary: proposal.summary, subjectiveInterpretation: proposal.subjectiveInterpretation, emotions: proposal.emotions,
            participantIds: task.participantIds, locationId: task.locationId, salience: proposal.salience ?? 0.5, occurredAt: completedAt,
          });
          this.store.saveSceneNarrativeProjection({
            id: randomUUID(), sessionId: task.sessionId, sourceEventIds: episode.sourceEventIds, participantIds: task.participantIds,
            locationId: task.locationId, publicSummary: proposal.publicSummary?.trim() || episode.summary,
            openThreads: unique(proposal.openThreads ?? []), storyPressures: unique(proposal.storyPressures ?? []), createdAt: completedAt,
          });
          this.jobs.complete(job.id, workerId, completedAt);
        } else this.jobs.complete(job.id, workerId, completedAt);
      });
      return true;
    } catch (error) {
      const retryDelayMs = Math.min(300_000, 1_000 * 2 ** Math.min(task.attempts, 8));
      this.jobs.retry(job.id, workerId, error instanceof Error ? error.message : "memory_consolidation_failed", new Date(now.getTime() + retryDelayMs).toISOString());
      return true;
    }
  }

  public async drain(sessionId: string): Promise<number> {
    let processed = 0;
    while (await this.processNext(sessionId)) processed += 1;
    return processed;
  }

}

function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }

function memoryTaskFromJob(job: DurableJob): MemoryConsolidationTask {
  const payload = job.payload;
  if (typeof payload.characterId !== "string" || !Array.isArray(payload.sourceEvidenceIds) || !Array.isArray(payload.participantIds)
    || (payload.trigger !== "battle_aftermath" && payload.trigger !== "important_dialogue")) throw new Error("invalid_memory_l1_job_payload");
  return {
    id: job.id, sessionId: job.sessionId, characterId: payload.characterId, trigger: payload.trigger,
    sourceEvidenceIds: payload.sourceEvidenceIds.filter((id): id is string => typeof id === "string"),
    participantIds: payload.participantIds.filter((id): id is string => typeof id === "string"),
    ...(typeof payload.locationId === "string" ? { locationId: payload.locationId } : {}),
    status: "processing", attempts: job.attempts, createdAt: job.createdAt, availableAt: job.availableAt, leasedAt: job.leasedAt,
  };
}
