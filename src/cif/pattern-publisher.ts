import { randomUUID } from "node:crypto";
import type { CifPatternDraft, EpistemicState, InterpretiveModel } from "./types.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

/** The only bridge from an approved L2 proposal into live, versioned CIF state. */
export class CifPatternPublisher {
  public constructor(private readonly repository: SqliteCifRepository) {}

  public publish(draftId: string, publishedAt = new Date().toISOString()): CifPatternDraft {
    return this.repository.transaction(() => this.publishInTransaction(draftId, publishedAt));
  }

  /**
   * Publishes while the caller already owns the SQLite transaction.  Durable
   * audit workers use this so their verdict, live-state update, and job
   * completion form one atomic unit without opening a nested transaction.
   */
  public publishInTransaction(draftId: string, publishedAt = new Date().toISOString()): CifPatternDraft {
    const stored = this.repository.getPatternDraft(draftId);
    if (!stored || stored.status !== "approved") throw new Error("pattern_draft_must_be_approved_before_publish");
    if (stored.validationErrors.length || !stored.proposal.shouldPropose) throw new Error("pattern_draft_not_publishable");
    const proposal = stored.proposal;
    if (proposal.relationship) this.publishRelationship(stored, publishedAt);
    if (proposal.belief) this.publishBelief(stored, publishedAt);
    if (proposal.recurringGoal) this.publishGoal(stored, publishedAt);
    this.repository.publishPatternDraft(stored.id, publishedAt);
    const published = this.repository.getPatternDraft(draftId);
    if (!published) throw new Error("pattern_draft_disappeared_after_publish");
    return published;
  }

  private publishRelationship(draft: CifPatternDraft, publishedAt: string): void {
    const proposal = draft.proposal.relationship!;
    const existing = this.repository.listInterpretiveModels(draft.sessionId, draft.characterId, 100)
      .filter((model) => model.kind === "social" && model.targetId === proposal.targetId);
    const model: InterpretiveModel = {
      id: randomUUID(), sessionId: draft.sessionId, characterId: draft.characterId, kind: "social", targetId: proposal.targetId,
      content: proposal.content, activation: proposal.confidence, supportingEvidenceIds: draft.proposal.sourceEpisodeIds, opposingEvidenceIds: [],
      scope: "l2:relationship", stability: "moderate", revisionConditions: ["contrary future memories"], version: Math.max(0, ...existing.map((item) => item.version)) + 1,
    };
    this.repository.saveInterpretiveModel(model);
  }

  private publishBelief(draft: CifPatternDraft, _publishedAt: string): void {
    const proposal = draft.proposal.belief!;
    const existing = this.repository.listEpistemicStates(draft.sessionId, draft.characterId, 100).filter((state) => state.proposition === proposal.proposition);
    const state: EpistemicState = {
      id: randomUUID(), sessionId: draft.sessionId, characterId: draft.characterId, proposition: proposal.proposition, status: proposal.status,
      confidence: proposal.confidence, supportingEvidenceIds: draft.proposal.sourceEpisodeIds, opposingEvidenceIds: [], version: Math.max(0, ...existing.map((item) => item.version)) + 1,
    };
    this.repository.saveEpistemicState(state);
  }

  private publishGoal(draft: CifPatternDraft, publishedAt: string): void {
    const previous = this.repository.getRuntimeState(draft.sessionId, draft.characterId);
    if (!previous) throw new Error("pattern_runtime_state_missing");
    const activeGoals = [...new Set([draft.proposal.recurringGoal!.content, ...previous.activeGoals])].slice(0, 5);
    this.repository.saveRuntimeState({ ...previous, activeGoals, updatedAt: publishedAt });
    const factors = this.repository.getAppearanceFactors(draft.sessionId, draft.characterId);
    if (factors) this.repository.saveAppearanceFactors({ ...factors, activeGoals, updatedAt: publishedAt });
  }
}
