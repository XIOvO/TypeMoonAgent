import { randomUUID } from "node:crypto";
import type { DurableJob, DurableJobQueue } from "../core/durable-jobs.js";
import { validateCognitiveAuditVerdict, type CognitiveAuditVerdict } from "../core/cognitive-evolution.js";
import type { CifL3RevisionDraft, EpisodeMemory, EpistemicState, IdentityModel, InterpretiveModel } from "./types.js";
import { type CifL3RevisionBrief, type CifL3RevisionProposal, validateCifL3RevisionProposal } from "./revision.js";

export interface CifL3RevisionGenerator { generate(brief: CifL3RevisionBrief): Promise<CifL3RevisionProposal>; }
export interface CifL3RevisionAuditor { audit(input: { brief: CifL3RevisionBrief; proposal: CifL3RevisionProposal }): Promise<CognitiveAuditVerdict>; }
export interface CifL3RevisionStore {
  listIdentity(sessionId: string, characterId: string): IdentityModel[];
  listEpisodeMemories(sessionId: string, characterId: string): EpisodeMemory[];
  listEpistemicStates(sessionId: string, characterId: string, limit: number): EpistemicState[];
  listInterpretiveModels(sessionId: string, characterId: string, limit: number): InterpretiveModel[];
  saveL3RevisionDraft(draft: CifL3RevisionDraft): void;
  getL3RevisionDraft(id: string): CifL3RevisionDraft | undefined;
  resolveL3RevisionAudit(id: string, status: "approved" | "deferred" | "rejected", audit: CognitiveAuditVerdict, reviewedAt: string): void;
}
export interface CifL3RevisionPublicationPort { publishInTransaction(draftId: string, publishedAt: string): CifL3RevisionDraft; }

/** Generates frozen, single-section L3 proposals. Scheduling remains a separate policy concern. */
export class CifL3RevisionWorker {
  public constructor(private readonly jobs: DurableJobQueue, private readonly store: CifL3RevisionStore, private readonly generator: CifL3RevisionGenerator, private readonly generatorName = "pi-cif-l3-revision") {}
  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "memory-l3-worker";
    const job = this.jobs.claim({ sessionId, workerId, kind: "memory.l3", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString() });
    if (!job) return false;
    try {
      const input = inputFromJob(job);
      const episodes = this.store.listEpisodeMemories(sessionId, input.characterId).filter((episode) => episode.status === "active").sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 12);
      if (episodes.length < 3 || !episodes.some((episode) => episode.id === input.triggerEpisodeId)) { this.jobs.complete(job.id, workerId, now.toISOString()); return true; }
      const brief = buildBrief(this.store, sessionId, input.characterId, input.triggerEpisodeId, episodes);
      const proposal = await this.generator.generate(brief);
      const errors = validateCifL3RevisionProposal(brief, proposal);
      const status: CifL3RevisionDraft["status"] = errors.length ? "invalid" : proposal.revisions.length ? "pending_audit" : "no_change";
      this.jobs.transaction(() => {
        const draftId = randomUUID();
        this.store.saveL3RevisionDraft({ id: draftId, sessionId, characterId: input.characterId, triggerEpisodeId: input.triggerEpisodeId, status, proposal, validationErrors: errors, generator: this.generatorName, createdAt: now.toISOString() });
        if (status === "pending_audit") this.jobs.enqueue({ id: randomUUID(), sessionId, kind: "memory.l3.audit", dedupeKey: draftId, payload: { draftId }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: now.toISOString(), createdAt: now.toISOString() });
        this.jobs.complete(job.id, workerId, now.toISOString());
      });
      return true;
    } catch (error) { this.jobs.retry(job.id, workerId, error instanceof Error ? error.message : "cif_l3_revision_failed", new Date(now.getTime() + 1_000).toISOString()); return true; }
  }
  public async drain(sessionId: string): Promise<number> { let count = 0; while (await this.processNext(sessionId)) count += 1; return count; }
}

/** Audits a frozen L3 proposal and only publishes a program-approved low-risk refinement. */
export class CifL3RevisionAuditWorker {
  public constructor(private readonly jobs: DurableJobQueue, private readonly store: CifL3RevisionStore, private readonly auditor: CifL3RevisionAuditor, private readonly publisher: CifL3RevisionPublicationPort) {}
  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "memory-l3-audit-worker";
    const job = this.jobs.claim({ sessionId, workerId, kind: "memory.l3.audit", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString() });
    if (!job) return false;
    try {
      const draftId = job.payload.draftId;
      if (typeof draftId !== "string") throw new Error("invalid_memory_l3_audit_job_payload");
      const draft = this.store.getL3RevisionDraft(draftId);
      if (!draft || draft.sessionId !== sessionId || draft.status !== "pending_audit") { this.jobs.complete(job.id, workerId, now.toISOString()); return true; }
      const episodes = this.store.listEpisodeMemories(sessionId, draft.characterId).filter((episode) => draft.proposal.revisions.some((revision) => revision.sourceEpisodeIds.includes(episode.id)));
      const brief = buildBrief(this.store, sessionId, draft.characterId, draft.triggerEpisodeId, episodes);
      const verdict = await this.auditor.audit({ brief, proposal: draft.proposal });
      const proposalErrors = validateCifL3RevisionProposal(brief, draft.proposal);
      const auditErrors = validateCognitiveAuditVerdict({ layer: "l3", allowedInputIds: draft.proposal.revisions.flatMap((revision) => revision.sourceEpisodeIds), requiredInputId: draft.triggerEpisodeId, minimumDistinctInputs: 3, verdict });
      const status: "approved" | "deferred" | "rejected" = proposalErrors.length || auditErrors.length || verdict.decision === "reject" ? "rejected" : verdict.decision === "defer" || verdict.risk !== "low" ? "deferred" : "approved";
      this.jobs.transaction(() => { this.store.resolveL3RevisionAudit(draft.id, status, verdict, now.toISOString()); if (status === "approved") this.publisher.publishInTransaction(draft.id, now.toISOString()); this.jobs.complete(job.id, workerId, now.toISOString()); });
      return true;
    } catch (error) { this.jobs.retry(job.id, workerId, error instanceof Error ? error.message : "cif_l3_audit_failed", new Date(now.getTime() + 1_000).toISOString()); return true; }
  }
  public async drain(sessionId: string): Promise<number> { let count = 0; while (await this.processNext(sessionId)) count += 1; return count; }
}

function buildBrief(store: CifL3RevisionStore, sessionId: string, characterId: string, triggerEpisodeId: string, episodes: EpisodeMemory[]): CifL3RevisionBrief {
  return { sessionId, characterId, triggerEpisodeId, episodes, identity: store.listIdentity(sessionId, characterId), epistemicStates: store.listEpistemicStates(sessionId, characterId, 5), interpretiveModels: store.listInterpretiveModels(sessionId, characterId, 5) };
}
function inputFromJob(job: DurableJob): { characterId: string; triggerEpisodeId: string } {
  const { characterId, triggerEpisodeId } = job.payload;
  if (typeof characterId !== "string" || typeof triggerEpisodeId !== "string") throw new Error("invalid_memory_l3_job_payload");
  return { characterId, triggerEpisodeId };
}
