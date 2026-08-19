import { randomUUID } from "node:crypto";
import type { DurableJob, DurableJobQueue } from "../core/durable-jobs.js";
import { validateCognitiveAuditVerdict, type CognitiveAuditVerdict } from "../core/cognitive-evolution.js";
import type { CifPatternDraft, CifPatternProposal, EpisodeMemory, EpistemicState, InterpretiveModel } from "./types.js";

export interface PatternConsolidationBrief {
  sessionId: string;
  characterId: string;
  triggerEpisodeId: string;
  episodes: EpisodeMemory[];
  epistemicStates: EpistemicState[];
  interpretiveModels: InterpretiveModel[];
}

export interface PatternConsolidationGenerator {
  generate(brief: PatternConsolidationBrief): Promise<CifPatternProposal>;
}
export interface PatternConsolidationAuditor {
  audit(input: { brief: PatternConsolidationBrief; proposal: CifPatternProposal }): Promise<CognitiveAuditVerdict>;
}
export interface PatternPublicationPort { publishInTransaction(draftId: string, publishedAt: string): CifPatternDraft; }

export interface PatternConsolidationStore {
  listEpisodeMemories(sessionId: string, characterId: string): EpisodeMemory[];
  listEpistemicStates(sessionId: string, characterId: string, limit: number): EpistemicState[];
  listInterpretiveModels(sessionId: string, characterId: string, limit: number): InterpretiveModel[];
  savePatternDraft(draft: CifPatternDraft): void;
  getPatternDraft(id: string): CifPatternDraft | undefined;
  resolvePatternDraftAudit(id: string, status: "approved" | "deferred" | "rejected", audit: CifPatternDraft["audit"], reviewedAt: string): void;
}

/** L2 turns several L1 memories into a reviewable pattern proposal, never live CIF. */
export class PatternConsolidationWorker {
  public constructor(private readonly jobs: DurableJobQueue, private readonly store: PatternConsolidationStore, private readonly generator: PatternConsolidationGenerator, private readonly generatorName = "pi-pattern-consolidator") {}

  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "memory-l2-worker";
    const job = this.jobs.claim({ sessionId, workerId, kind: "memory.l2", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString() });
    if (!job) return false;
    try {
      const input = inputFromJob(job);
      const episodes = this.store.listEpisodeMemories(sessionId, input.characterId).filter((episode) => episode.status === "active")
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 8);
      if (episodes.length < 2 || !episodes.some((episode) => episode.id === input.triggerEpisodeId)) {
        this.jobs.complete(job.id, workerId, now.toISOString());
        return true;
      }
      const brief: PatternConsolidationBrief = {
        sessionId, characterId: input.characterId, triggerEpisodeId: input.triggerEpisodeId, episodes,
        epistemicStates: this.store.listEpistemicStates(sessionId, input.characterId, 5),
        interpretiveModels: this.store.listInterpretiveModels(sessionId, input.characterId, 5),
      };
      const proposal = await this.generator.generate(brief);
      const errors = validatePatternProposal(brief, proposal);
      const status: CifPatternDraft["status"] = errors.length ? "invalid" : proposal.shouldPropose ? "pending_audit" : "no_change";
      this.jobs.transaction(() => {
        const draftId = randomUUID();
        this.store.savePatternDraft({ id: draftId, sessionId, characterId: input.characterId, triggerEpisodeId: input.triggerEpisodeId, status, proposal, validationErrors: errors, generator: this.generatorName, createdAt: now.toISOString() });
        if (status === "pending_audit") this.jobs.enqueue({ id: randomUUID(), sessionId, kind: "memory.l2.audit", dedupeKey: draftId, payload: { draftId }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: now.toISOString(), createdAt: now.toISOString() });
        this.jobs.complete(job.id, workerId, now.toISOString());
      });
      return true;
    } catch (error) {
      this.jobs.retry(job.id, workerId, error instanceof Error ? error.message : "pattern_consolidation_failed", new Date(now.getTime() + 1_000).toISOString());
      return true;
    }
  }

  public async drain(sessionId: string): Promise<number> { let count = 0; while (await this.processNext(sessionId)) count += 1; return count; }
}

/** Audits a frozen L2 proposal separately, so an audit retry never regenerates it. */
export class PatternAuditWorker {
  public constructor(private readonly jobs: DurableJobQueue, private readonly store: PatternConsolidationStore, private readonly auditor: PatternConsolidationAuditor, private readonly publisher: PatternPublicationPort) {}
  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "memory-l2-audit-worker";
    const job = this.jobs.claim({ sessionId, workerId, kind: "memory.l2.audit", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString() });
    if (!job) return false;
    try {
      const draftId = job.payload.draftId;
      if (typeof draftId !== "string") throw new Error("invalid_memory_l2_audit_job_payload");
      const draft = this.store.getPatternDraft(draftId);
      if (!draft || draft.sessionId !== sessionId || draft.status !== "pending_audit") { this.jobs.complete(job.id, workerId, now.toISOString()); return true; }
      const episodes = this.store.listEpisodeMemories(sessionId, draft.characterId).filter((episode) => draft.proposal.sourceEpisodeIds.includes(episode.id));
      const brief: PatternConsolidationBrief = { sessionId, characterId: draft.characterId, triggerEpisodeId: draft.triggerEpisodeId, episodes,
        epistemicStates: this.store.listEpistemicStates(sessionId, draft.characterId, 5), interpretiveModels: this.store.listInterpretiveModels(sessionId, draft.characterId, 5) };
      const verdict = await this.auditor.audit({ brief, proposal: draft.proposal });
      const errors = validateCognitiveAuditVerdict({ layer: "l2", allowedInputIds: draft.proposal.sourceEpisodeIds, requiredInputId: draft.triggerEpisodeId, verdict });
      const status: "approved" | "deferred" | "rejected" = errors.length || verdict.decision === "reject" ? "rejected" : verdict.decision === "defer" || verdict.risk !== "low" ? "deferred" : "approved";
      this.jobs.transaction(() => {
        this.store.resolvePatternDraftAudit(draft.id, status, verdict, now.toISOString());
        if (status === "approved") this.publisher.publishInTransaction(draft.id, now.toISOString());
        this.jobs.complete(job.id, workerId, now.toISOString());
      });
      return true;
    } catch (error) {
      this.jobs.retry(job.id, workerId, error instanceof Error ? error.message : "pattern_audit_failed", new Date(now.getTime() + 1_000).toISOString());
      return true;
    }
  }
  public async drain(sessionId: string): Promise<number> { let count = 0; while (await this.processNext(sessionId)) count += 1; return count; }
}

export function validatePatternProposal(brief: PatternConsolidationBrief, proposal: CifPatternProposal): string[] {
  const errors: string[] = [];
  const episodeIds = new Set(brief.episodes.map((episode) => episode.id));
  if (proposal.characterId !== brief.characterId) errors.push("pattern_character_mismatch");
  if (new Set(proposal.sourceEpisodeIds).size < 2) errors.push("pattern_requires_two_distinct_episodes");
  if (!proposal.sourceEpisodeIds.includes(brief.triggerEpisodeId)) errors.push("pattern_requires_trigger_episode");
  if (proposal.sourceEpisodeIds.some((id) => !episodeIds.has(id))) errors.push("pattern_references_unknown_episode");
  const changes = [proposal.relationship, proposal.belief, proposal.recurringGoal].filter(Boolean);
  if (!proposal.shouldPropose && changes.length) errors.push("pattern_no_change_with_updates");
  if (proposal.shouldPropose && (!changes.length || !proposal.rationale?.trim())) errors.push("pattern_requires_change_and_rationale");
  if (proposal.relationship && (!proposal.relationship.targetId.trim() || !proposal.relationship.content.trim() || !bounded(proposal.relationship.confidence))) errors.push("pattern_relationship_invalid");
  if (proposal.belief && (!proposal.belief.proposition.trim() || !bounded(proposal.belief.confidence))) errors.push("pattern_belief_invalid");
  if (proposal.recurringGoal && (!proposal.recurringGoal.content.trim() || !bounded(proposal.recurringGoal.confidence))) errors.push("pattern_goal_invalid");
  return [...new Set(errors)];
}

function inputFromJob(job: DurableJob): { characterId: string; triggerEpisodeId: string } {
  const { characterId, triggerEpisodeId } = job.payload;
  if (typeof characterId !== "string" || typeof triggerEpisodeId !== "string") throw new Error("invalid_memory_l2_job_payload");
  return { characterId, triggerEpisodeId };
}
function bounded(value: number): boolean { return Number.isFinite(value) && value >= 0 && value <= 1; }
