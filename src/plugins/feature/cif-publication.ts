import { Service, type Context } from "@deepseek-ai/cordis";
import type { CifPublicationController, CifPatternDraftView } from "../../core/cif-publication.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";

export const WORLD_CIF_PUBLICATION_CAPABILITY = "world.cifPublication";

export interface CifPublicationStore {
  listPatternDrafts(sessionId: string, characterId: string): CifPatternDraftView[];
  getPatternDraft(draftId: string): CifPatternDraftView | undefined;
  setPatternDraftStatus(draftId: string, status: "approved" | "rejected", reviewedAt: string): void;
}

export interface CifPublicationPublisher {
  publish(draftId: string): CifPatternDraftView;
}

class CifPublicationService extends Service implements CifPublicationController {
  public constructor(ctx: Context, private readonly store: CifPublicationStore, private readonly publisher: CifPublicationPublisher) { super(ctx, "worldCifPublication"); }
  public listPatternDrafts(sessionId: string, characterId: string) { return this.store.listPatternDrafts(sessionId, characterId); }
  public approvePatternDraft(sessionId: string, draftId: string) { return this.review(sessionId, draftId, "approved"); }
  public rejectPatternDraft(sessionId: string, draftId: string) { return this.review(sessionId, draftId, "rejected"); }
  public publishPatternDraft(sessionId: string, draftId: string) {
    const draft = this.store.getPatternDraft(draftId);
    if (!draft || draft.sessionId !== sessionId) throw new Error("unknown_pattern_draft");
    return this.publisher.publish(draftId);
  }
  private review(sessionId: string, draftId: string, status: "approved" | "rejected") {
    const draft = this.store.getPatternDraft(draftId);
    if (!draft || draft.sessionId !== sessionId) throw new Error("unknown_pattern_draft");
    if (draft.status !== "pending_review") throw new Error("pattern_draft_not_pending_review");
    this.store.setPatternDraftStatus(draftId, status, new Date().toISOString());
    return this.store.getPatternDraft(draftId)!;
  }
}

/** Controlled publication port for L2 today and reviewed L3 revisions later. */
export function createCifPublicationPlugin(store: CifPublicationStore, publisher: CifPublicationPublisher): CordisGamePluginDefinition {
  return { manifest: { id: "feature.cif-publication", version: "1.0.0", configVersion: 1, provides: [{ id: WORLD_CIF_PUBLICATION_CAPABILITY, serviceKey: "worldCifPublication" }] }, implementation: (ctx: Context) => { new CifPublicationService(ctx, store, publisher); } };
}
