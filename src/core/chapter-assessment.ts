import type { GameEvent } from "./contracts.js";
import type { BranchFact, ChapterAssessmentFactPolicy, WorldlineDivergence } from "./worldline.js";

export interface ChapterAssessmentProposal {
  shouldApply: boolean;
  sourceEventIds: string[];
  canonSourceFragmentIds: string[];
  changedFact?: { factKey: string; value: Record<string, unknown>; canonBaseline: Record<string, unknown> };
  divergence?: Omit<WorldlineDivergence, "id" | "sessionId" | "canonAnchor" | "sourceEventIds" | "changedFactKey" | "canonBaseline" | "branchReality" | "createdAt" | "updatedAt">;
  pendingImpactChapterIds: string[];
  rationale: string;
}

export interface ChapterAssessmentGenerator {
  generate(input: { packageId: string; canonAnchor: string; sourceFragmentIds: string[]; canonFragments: Array<{ id: string; text: string }>; confirmedEvents: GameEvent[]; branchFacts: BranchFact[]; assessmentPolicies: ChapterAssessmentFactPolicy[] }): Promise<ChapterAssessmentProposal>;
}

export interface CanonFragmentProvider {
  getFragmentsByIds(ids: readonly string[]): Array<{ id: string; text: string }>;
}
