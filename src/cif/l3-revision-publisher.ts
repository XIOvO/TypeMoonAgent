import { randomUUID } from "node:crypto";
import type { CifL3RevisionDraft } from "./types.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

/** The sole bridge from an approved L3 draft to a new, additive identity version. */
export class CifL3RevisionPublisher {
  public constructor(private readonly repository: SqliteCifRepository) {}
  public publish(draftId: string, publishedAt = new Date().toISOString()): CifL3RevisionDraft {
    return this.repository.transaction(() => this.publishInTransaction(draftId, publishedAt));
  }
  public publishInTransaction(draftId: string, publishedAt: string): CifL3RevisionDraft {
    const draft = this.repository.getL3RevisionDraft(draftId);
    if (!draft || draft.status !== "approved") throw new Error("l3_revision_must_be_approved_before_publish");
    if (draft.validationErrors.length || draft.proposal.revisions.length !== 1) throw new Error("l3_revision_not_publishable");
    const revision = draft.proposal.revisions[0]!;
    const current = this.repository.listIdentity(draft.sessionId, draft.characterId).find((item) => item.section === revision.section);
    if (!current) throw new Error("l3_revision_target_missing");
    this.repository.saveIdentity({ id: randomUUID(), sessionId: draft.sessionId, characterId: draft.characterId, section: revision.section, content: revision.proposedContent, sourceIds: revision.sourceEpisodeIds, version: current.version + 1, origin: "l3_revision", reviewStatus: "published" });
    this.repository.publishL3RevisionDraft(draft.id, publishedAt);
    const published = this.repository.getL3RevisionDraft(draftId);
    if (!published) throw new Error("l3_revision_disappeared_after_publish");
    return published;
  }
}
