export interface CifPatternDraftView {
  id: string;
  sessionId: string;
  characterId: string;
  triggerEpisodeId: string;
  status: string;
  proposal: unknown;
  validationErrors: string[];
  generator: string;
  createdAt: string;
  reviewedAt?: string;
  publishedAt?: string;
}

/** Admin-facing contract; publication is deliberate and never model-triggered. */
export interface CifPublicationController {
  listPatternDrafts(sessionId: string, characterId: string): CifPatternDraftView[];
  approvePatternDraft(sessionId: string, draftId: string): CifPatternDraftView;
  rejectPatternDraft(sessionId: string, draftId: string): CifPatternDraftView;
  publishPatternDraft(sessionId: string, draftId: string): CifPatternDraftView;
}
