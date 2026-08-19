import { randomUUID } from "node:crypto";
import type { DurableJob, EventTaskScheduler } from "../core/durable-jobs.js";
import type { GameEvent, } from "../core/contracts.js";
import type { BranchFact, ChapterAssessmentFactPolicy, WorldlineDivergence } from "../core/worldline.js";
import type { ChapterAssessmentGenerator, ChapterAssessmentProposal } from "../core/chapter-assessment.js";
import type { CanonFragmentProvider } from "../core/chapter-assessment.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
export type { ChapterAssessmentGenerator, ChapterAssessmentProposal } from "../core/chapter-assessment.js";

/** Low-cost producer: only concrete world-changing event types are eligible. */
export class ChapterAssessmentScheduler implements EventTaskScheduler {
  public constructor(private readonly repository: SqliteCifRepository) {}
  public schedule(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (!isAssessmentCandidate(event)) continue;
      for (const chapter of this.repository.listActiveStoryChapterPackages(event.sessionId)) {
        this.repository.enqueueDurableJob({
          id: randomUUID(), sessionId: event.sessionId, kind: "chapter.assessment", dedupeKey: `${chapter.packageId}:${event.id}`,
          payload: { packageId: chapter.packageId, eventIds: [event.id] }, status: "pending", attempts: 0, maxAttempts: 3,
          availableAt: event.createdAt, createdAt: event.createdAt,
        });
      }
    }
  }
}

/** An AI may analyze a branch, but only a citation-valid proposal can write it. */
export class ChapterAssessmentWorker {
  public constructor(private readonly repository: SqliteCifRepository, private readonly generator: ChapterAssessmentGenerator, private readonly canon: CanonFragmentProvider) {}
  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "chapter-assessment-worker";
    const job = this.repository.claimDurableJob({ sessionId, workerId, kind: "chapter.assessment", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString() });
    if (!job) return false;
    try {
      const input = assessmentInput(job);
      const chapter = this.repository.listActiveStoryChapterPackages(sessionId).find((candidate) => candidate.packageId === input.packageId);
      if (!chapter) { this.repository.completeDurableJob(job.id, workerId, now.toISOString()); return true; }
      const events = this.repository.listObjectiveHistoryByIds(sessionId, input.eventIds);
      if (events.length !== input.eventIds.length) throw new Error("chapter_assessment_event_missing");
      const canonFragments = this.canon.getFragmentsByIds(chapter.sourceFragmentIds);
      if (canonFragments.length !== chapter.sourceFragmentIds.length) throw new Error("chapter_assessment_canon_source_missing");
      const policies = chapter.assessmentPolicies ?? [];
      const proposal = await this.generator.generate({ packageId: chapter.packageId, canonAnchor: chapter.canonAnchor, sourceFragmentIds: chapter.sourceFragmentIds, canonFragments, confirmedEvents: events, branchFacts: this.repository.listBranchFacts(sessionId), assessmentPolicies: policies });
      validateProposal(proposal, events, chapter.sourceFragmentIds, policies);
      this.repository.transaction(() => {
        if (proposal.shouldApply && proposal.changedFact && proposal.divergence) {
          const context = this.repository.getStoryContext(sessionId);
          if (!context) throw new Error("chapter_story_context_missing");
          this.repository.saveBranchFact({ id: randomUUID(), sessionId, factKey: proposal.changedFact.factKey, value: proposal.changedFact.value, sourceEventIds: proposal.sourceEventIds, updatedAt: now.toISOString() });
          this.repository.saveWorldlineDivergence({ id: randomUUID(), sessionId, canonAnchor: context.canonAnchor, sourceEventIds: proposal.sourceEventIds,
            changedFactKey: proposal.changedFact.factKey, canonBaseline: proposal.changedFact.canonBaseline, branchReality: proposal.changedFact.value,
            ...proposal.divergence, pendingImpactChapterIds: unique([...proposal.divergence.pendingImpactChapterIds, ...proposal.pendingImpactChapterIds]), createdAt: now.toISOString(), updatedAt: now.toISOString() });
        }
        this.repository.completeDurableJob(job.id, workerId, now.toISOString());
      });
      return true;
    } catch (error) {
      this.repository.retryDurableJob(job.id, workerId, error instanceof Error ? error.message : "chapter_assessment_failed", new Date(now.getTime() + 1_000).toISOString());
      return true;
    }
  }
}

function isAssessmentCandidate(event: GameEvent): boolean { return event.type === "object_interacted" || event.type === "battle_finished"; }
function assessmentInput(job: DurableJob): { packageId: string; eventIds: string[] } {
  const { packageId, eventIds } = job.payload;
  if (typeof packageId !== "string" || !Array.isArray(eventIds) || !eventIds.every((id) => typeof id === "string")) throw new Error("invalid_chapter_assessment_job");
  return { packageId, eventIds };
}
function validateProposal(proposal: ChapterAssessmentProposal, events: GameEvent[], sourceFragmentIds: string[], policies: readonly ChapterAssessmentFactPolicy[]): void {
  if (!proposal.sourceEventIds.every((id) => events.some((event) => event.id === id))) throw new Error("chapter_assessment_unseen_event_citation");
  if (!proposal.canonSourceFragmentIds.every((id) => sourceFragmentIds.includes(id))) throw new Error("chapter_assessment_unknown_canon_citation");
  if (!proposal.shouldApply) return;
  if (!proposal.changedFact || !proposal.divergence || !proposal.sourceEventIds.length || !proposal.canonSourceFragmentIds.length || !proposal.rationale.trim()) throw new Error("chapter_assessment_incomplete_proposal");
  const policy = policies.find((candidate) => candidate.factKey === proposal.changedFact!.factKey);
  if (!policy) throw new Error("chapter_assessment_fact_not_permitted");
  if (!proposal.sourceEventIds.every((id) => policy.allowedEventTypes.includes(events.find((event) => event.id === id)!.type))) throw new Error("chapter_assessment_event_type_not_permitted");
  if (!proposal.canonSourceFragmentIds.every((id) => policy.allowedCanonSourceFragmentIds.includes(id))) throw new Error("chapter_assessment_canon_not_permitted");
  if (!matchesPolicyRecord(proposal.changedFact.value, policy.allowedValue) || !matchesPolicyRecord(proposal.changedFact.canonBaseline, policy.allowedCanonBaseline)) throw new Error("chapter_assessment_fact_value_not_permitted");
  const divergence = proposal.divergence;
  if (!policy.allowedSignificances.includes(divergence.significance) || !policy.allowedAffectedScopes.includes(divergence.affectedScope)
    || !divergence.knownImpactNodeIds.every((id) => policy.allowedKnownImpactNodeIds.includes(id))
    || ![...divergence.pendingImpactChapterIds, ...proposal.pendingImpactChapterIds].every((id) => policy.allowedPendingImpactChapterIds.includes(id))) throw new Error("chapter_assessment_divergence_not_permitted");
}
function matchesPolicyRecord(value: Record<string, unknown>, allowed: Record<string, readonly (string | number | boolean)[]>): boolean {
  const keys = Object.keys(value);
  return keys.length === Object.keys(allowed).length && keys.every((key) => typeof value[key] !== "object" && allowed[key]?.includes(value[key] as string | number | boolean) === true);
}
function unique(values: string[]): string[] { return [...new Set(values)]; }
