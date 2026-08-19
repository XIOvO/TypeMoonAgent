import type { IdentityModel, IdentitySection, EpisodeMemory, EpistemicState, InterpretiveModel } from "./types.js";

/** Only these adaptive expression layers may be automatically evolved by L3. */
export const AUTO_L3_SECTIONS: readonly IdentitySection[] = ["appraisal_tendencies", "emotional_pattern", "practical_judgment", "expression_filter", "voice_embodiment", "growth_boundaries"];

/** Read-only input for a future reviewed L3 job; it deliberately carries no database write capability. */
export interface CifL3RevisionBrief {
  sessionId: string;
  characterId: string;
  triggerEpisodeId: string;
  identity: IdentityModel[];
  epistemicStates: EpistemicState[];
  interpretiveModels: InterpretiveModel[];
  episodes: EpisodeMemory[];
}

export interface CifL3RevisionProposal {
  characterId: string;
  revisions: Array<{
    section: IdentitySection;
    proposedContent: string;
    rationale: string;
    sourceEpisodeIds: string[];
    confidence: "high" | "medium" | "low";
  }>;
  reviewFlags: string[];
}

/** Validates the narrow automatic L3 policy before an audited new version is appended. */
export function validateCifL3RevisionProposal(brief: CifL3RevisionBrief, proposal: CifL3RevisionProposal): string[] {
  const errors: string[] = [];
  const episodeIds = new Set(brief.episodes.map((episode) => episode.id));
  const existingSections = new Set(brief.identity.map((model) => model.section));
  if (proposal.characterId !== brief.characterId) errors.push("character_id_mismatch");
  if (proposal.revisions.length > 1) errors.push("revision_allows_one_section_per_draft");
  for (const revision of proposal.revisions) {
    if (!existingSections.has(revision.section)) errors.push("revision_targets_missing_identity_section");
    if (!AUTO_L3_SECTIONS.includes(revision.section)) errors.push("revision_section_not_auto_publishable");
    if (!revision.proposedContent.trim() || !revision.rationale.trim()) errors.push("revision_requires_content_and_rationale");
    if (revision.proposedContent.trim().length > 1_000) errors.push("revision_content_too_long");
    if (revision.confidence !== "high") errors.push("revision_requires_high_confidence");
    if (new Set(revision.sourceEpisodeIds).size < 3) errors.push("revision_requires_three_distinct_episodes");
    if (!revision.sourceEpisodeIds.includes(brief.triggerEpisodeId)) errors.push("revision_requires_trigger_episode");
    if (revision.sourceEpisodeIds.some((id) => !episodeIds.has(id))) errors.push("revision_references_unknown_episode");
  }
  return [...new Set(errors)];
}
