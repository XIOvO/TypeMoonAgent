import type { ScriptSearchResult } from "../lore/types.js";
import { SqliteLoreRepository } from "../lore/sqlite-repository.js";
import type { IdentitySection } from "./types.js";
import { buildCifInitializationPrompt as buildPrompt } from "./prompts.js";
import { ServantProfileAccessPolicy } from "./servant-profile-access.js";

export interface CharacterIntroductionRequest {
  sessionId: string; playerId?: string;
  characterId: string;
  displayName: string;
  aliases?: string[];
  variantId: string;
  storyPointId: string;
  introduction: { locationId: string; presentEntityIds: string[]; reason: "story_trigger" | "summon" | "encounter" | "gm_request" };
  canonScope: { region: string; warId?: number; maxQuestId?: number };
}

export interface CifSourceEvidence {
  chunkId: string;
  scriptId: string;
  questId?: number;
  questName?: string;
  chunkOrder: number;
  excerpt: string;
  matchedTerms: string[];
}

export interface CifInitializationBrief {
  request: CharacterIntroductionRequest;
  evidence: CifSourceEvidence[];
  gaps: string[];
}

export interface CifInitializationDraft {
  characterId: string;
  variantId: string;
  storyPointId: string;
  identity: Array<{ section: IdentitySection; content: string; sourceChunkIds: string[]; confidence: "high" | "medium" | "low" }>;
  profile: { ageOrLifeStage?: string; socialIdentity?: string; affiliation?: string; homeRegion?: string; objectiveStatus?: string; sourceChunkIds: string[] };
  capabilities: Array<{ category: "sensory" | "language" | "professional" | "special" | "limitation"; content: string; mechanicalTags: string[]; sourceChunkIds: string[] }>;
  lifeContext: { scheduleSummary?: string; responsibilities: string[]; currentProblems: string[]; availableResources: string[]; missingResources: string[]; independentLifeSummary?: string; sourceChunkIds: string[] };
  objectiveRelationships: Array<{ targetId: string; relationType: string; sharedHistorySummary?: string; currentObjectiveStatus?: string; sourceChunkIds: string[] }>;
  initialKnowledge: Array<{ proposition: string; sourceChunkIds: string[]; confidence: "high" | "medium" | "low" }>;
  initialRelationships: Array<{ targetId: string; summary: string; sourceChunkIds: string[]; confidence: "high" | "medium" | "low" }>;
  initialRuntimeState: { mood: "calm" | "alert"; activeGoals: string[] };
  reviewFlags: string[];
}

export type CifDraftStatus = "draft" | "invalid" | "approved" | "rejected" | "published";

export interface CifInitializationDraftRecord {
  id: string;
  status: CifDraftStatus;
  brief: CifInitializationBrief;
  draft: CifInitializationDraft;
  validationErrors: string[];
  generator: string;
  createdAt: string;
  reviewedAt?: string;
}

/** A low-frequency worker contract; normal turn agents do not implement this. */
export interface CifDraftGenerator {
  generate(brief: CifInitializationBrief): Promise<CifInitializationDraft>;
}

/** Builds evidence, not personality. A configurable model may later turn this brief into a draft. */
export class CifInitializer {
  public constructor(private readonly lore: SqliteLoreRepository, private readonly profileAccess?: ServantProfileAccessPolicy) {}

  public buildBrief(request: CharacterIntroductionRequest, evidenceLimit = 6): CifInitializationBrief {
    const terms = unique([request.displayName, ...(request.aliases ?? [])].filter((term) => term.trim()));
    const candidates = new Map<string, { result: ScriptSearchResult; terms: string[] }>();
    const profileCandidates: Array<{ result: ScriptSearchResult; terms: string[] }> = [];
    for (const term of terms) {
      for (const result of this.lore.search(term, evidenceLimit, request.canonScope)) {
        const existing = candidates.get(result.id);
        if (existing) existing.terms.push(term);
        else candidates.set(result.id, { result, terms: [term] });
      }
    }
    if (request.playerId && this.profileAccess) {
      for (const result of this.profileAccess.listVisible({ sessionId: request.sessionId, playerId: request.playerId,
        characterId: request.characterId, region: request.canonScope.region, names: terms, limit: Math.min(3, evidenceLimit) })) {
        profileCandidates.push({ result: { id: result.id, documentId: result.documentId, scriptId: result.scriptId,
          contentKind: "servant_profile", chunkOrder: result.entryOrder, text: result.text, speakerNames: [result.displayName],
          dialogueIds: [], spoilerUnlockKey: "profile_policy_checked", matchKind: "substring" }, terms: [result.displayName] });
      }
    }
    const evidence = [...profileCandidates, ...candidates.values()].slice(0, evidenceLimit).map(({ result, terms: matchedTerms }) => ({
      chunkId: result.id, scriptId: result.scriptId, questId: result.questId, questName: result.questName,
      chunkOrder: result.chunkOrder, excerpt: compactExcerpt(result.text, 420), matchedTerms: unique(matchedTerms),
    }));
    const gaps: string[] = [];
    if (!evidence.length) gaps.push("no_canon_evidence_found");
    if (evidence.length < 2) gaps.push("insufficient_behavioral_evidence");
    return { request, evidence, gaps };
  }
}

/** Provider-neutral prompt. The caller chooses whether and how to invoke an LLM. */
export function buildCifInitializationPrompt(brief: CifInitializationBrief): string {
  return buildPrompt(brief);
}

/** Prevents an initializer output from silently crossing the evidence boundary before persistence. */
export function validateCifInitializationDraft(brief: CifInitializationBrief, draft: CifInitializationDraft): string[] {
  const errors: string[] = [];
  const sources = new Set(brief.evidence.map((evidence) => evidence.chunkId));
  if (draft.characterId !== brief.request.characterId) errors.push("character_id_mismatch");
  if (draft.variantId !== brief.request.variantId) errors.push("variant_id_mismatch");
  if (draft.storyPointId !== brief.request.storyPointId) errors.push("story_point_id_mismatch");
  const sourced = [...draft.identity, ...draft.initialKnowledge, ...draft.initialRelationships, draft.profile, ...draft.capabilities, draft.lifeContext, ...draft.objectiveRelationships];
  for (const item of sourced) {
    if (!item.sourceChunkIds.length) errors.push("claim_without_source");
    if (item.sourceChunkIds.some((id) => !sources.has(id))) errors.push("claim_references_unknown_source");
  }
  for (const identity of draft.identity) if (!identity.content.trim()) errors.push("identity_content_empty");
  for (const knowledge of draft.initialKnowledge) if (!knowledge.proposition.trim()) errors.push("knowledge_proposition_empty");
  for (const relationship of draft.initialRelationships) {
    if (!relationship.summary.trim()) errors.push("relationship_summary_empty");
    if (!brief.request.introduction.presentEntityIds.includes(relationship.targetId)) errors.push("relationship_target_not_present_at_introduction");
  }
  for (const relationship of draft.objectiveRelationships) {
    if (!relationship.relationType.trim()) errors.push("objective_relationship_type_empty");
    if (!relationship.targetId.trim()) errors.push("objective_relationship_target_empty");
  }
  for (const capability of draft.capabilities) if (!capability.content.trim()) errors.push("capability_content_empty");
  if (!draft.initialRuntimeState.activeGoals.every((goal) => goal.trim())) errors.push("runtime_goal_empty");
  if (brief.gaps.includes("no_canon_evidence_found") && !draft.reviewFlags.includes("no_canon_evidence_found")) errors.push("missing_evidence_review_flag");
  return unique(errors);
}

function compactExcerpt(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
