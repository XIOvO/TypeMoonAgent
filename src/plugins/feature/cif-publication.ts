import { Service, type Context } from "@deepseek-ai/cordis";
import { CifPatternPublisher } from "../../cif/pattern-publisher.js";
import { SqliteCifRepository } from "../../cif/sqlite-repository.js";
import type { CifPublicationController } from "../../core/cif-publication.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";

export const WORLD_CIF_PUBLICATION_CAPABILITY = "world.cifPublication";

class CifPublicationService extends Service implements CifPublicationController {
  public constructor(ctx: Context, private readonly repository: SqliteCifRepository, private readonly publisher: CifPatternPublisher) { super(ctx, "worldCifPublication"); }
  public listPatternDrafts(sessionId: string, characterId: string) { return this.repository.listPatternDrafts(sessionId, characterId); }
  public approvePatternDraft(sessionId: string, draftId: string) { return this.review(sessionId, draftId, "approved"); }
  public rejectPatternDraft(sessionId: string, draftId: string) { return this.review(sessionId, draftId, "rejected"); }
  public publishPatternDraft(sessionId: string, draftId: string) {
    const draft = this.repository.getPatternDraft(draftId);
    if (!draft || draft.sessionId !== sessionId) throw new Error("unknown_pattern_draft");
    return this.publisher.publish(draftId);
  }
  private review(sessionId: string, draftId: string, status: "approved" | "rejected") {
    const draft = this.repository.getPatternDraft(draftId);
    if (!draft || draft.sessionId !== sessionId) throw new Error("unknown_pattern_draft");
    if (draft.status !== "pending_review") throw new Error("pattern_draft_not_pending_review");
    this.repository.setPatternDraftStatus(draftId, status, new Date().toISOString());
    return this.repository.getPatternDraft(draftId)!;
  }
}

/** Controlled publication port for L2 today and reviewed L3 revisions later. */
export function createCifPublicationPlugin(repository: SqliteCifRepository): CordisGamePluginDefinition {
  const publisher = new CifPatternPublisher(repository);
  return { manifest: { id: "feature.cif-publication", version: "1.0.0", configVersion: 1, provides: [{ id: WORLD_CIF_PUBLICATION_CAPABILITY, serviceKey: "worldCifPublication" }] }, implementation: (ctx: Context) => { new CifPublicationService(ctx, repository, publisher); } };
}
