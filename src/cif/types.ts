/** CIF v0.2 data types persisted outside the LLM context. */
import type { CognitiveAuditVerdict } from "../core/cognitive-evolution.js";
export type EpistemicStatus =
  | "accepted"
  | "likely"
  | "possible"
  | "uncertain"
  | "contested"
  | "rejected"
  | "unknown"
  | "outdated";

/** The only vocabulary for long-term CIF identity sections. */
export const IDENTITY_SECTIONS = [
  /** Player-facing, source-linked overview of who this character is at this story point. */
  "character_brief",
  "self_model",
  "core_schema",
  "needs",
  "values",
  "possible_self",
  "dream",
  "commitment",
  "appraisal_tendencies",
  "emotional_pattern",
  "practical_judgment",
  "expression_filter",
  "voice_embodiment",
  "growth_boundaries",
] as const;

export type IdentitySection = typeof IDENTITY_SECTIONS[number];

export type CifIdentityOrigin = "canon_baseline" | "player_overlay" | "l3_revision";
export type CifReviewStatus = "draft" | "approved" | "published" | "rejected" | "needs_review";

export interface IdentityModel {
  id: string;
  sessionId: string;
  characterId: string;
  section: IdentitySection;
  content: string;
  sourceIds: string[];
  version: number;
  origin?: CifIdentityOrigin;
  reviewStatus?: CifReviewStatus;
}

/** Stable, source-linked external facts. This is not an LLM personality summary. */
export interface CharacterProfile {
  sessionId: string;
  characterId: string;
  variantId: string;
  storyPointId: string;
  displayName: string;
  aliases: string[];
  ageOrLifeStage?: string;
  socialIdentity?: string;
  affiliation?: string;
  homeRegion?: string;
  objectiveStatus?: string;
  sourceIds: string[];
  version: number;
}

export interface CharacterCapability {
  id: string;
  sessionId: string;
  characterId: string;
  category: "sensory" | "language" | "professional" | "special" | "limitation";
  content: string;
  mechanicalTags: string[];
  sourceIds: string[];
  version: number;
}

export interface CharacterLifeContext {
  sessionId: string;
  characterId: string;
  scheduleSummary?: string;
  responsibilities?: string[];
  currentProblems?: string[];
  availableResources?: string[];
  missingResources?: string[];
  independentLifeSummary?: string;
  sourceIds: string[];
  version: number;
}

export interface ObjectiveRelationship {
  id: string;
  sessionId: string;
  characterId: string;
  targetId: string;
  relationType: string;
  sharedHistorySummary?: string;
  currentObjectiveStatus?: string;
  sourceIds: string[];
  version: number;
}

/** Persistent player-character bond progression. It is a gameplay gate, not CIF personality or relationship prose. */
export interface CharacterBond {
  sessionId: string;
  playerId: string;
  characterId: string;
  level: number;
  points: number;
  totalPoints: number;
  updatedAt: string;
}

export interface EvidenceRecord {
  id: string;
  sessionId: string;
  characterId: string;
  kind: "observation" | "episode" | "testimony" | "learned" | "inference";
  content: string;
  sourceEventIds: string[];
  /** Origin category and trust are distinct from the character's confidence in it. */
  sourceType?: "world_event" | "testimony" | "canon" | "research" | "inference";
  sourceTrust?: number;
  verifiedStatus?: "unverified" | "verified" | "contradicted";
  sensoryImpression?: string;
  recallCues?: string[];
  reliability: number;
  importance: number;
  occurredAt: string;
}

/** A compact claim derived from evidence, never a replacement for the event log. */
export interface MemoryAtom {
  id: string;
  sessionId: string;
  ownerId: string;
  content: string;
  kind: "observed_fact" | "testimony" | "inference" | "appraisal";
  sourceEventIds: string[];
  participantIds: string[];
  locationId?: string;
  recallCues?: string[];
  confidence: number;
  importance: number;
  occurredAt: string;
}

/** A character-owned, source-linked recollection of one bounded scene. */
export interface EpisodeMemory {
  id: string;
  sessionId: string;
  ownerId: string;
  sourceEventIds: string[];
  factualAnchorIds: string[];
  summary: string;
  subjectiveInterpretation?: string;
  emotions: Array<{ type: string; intensity: number; targetId?: string }>;
  participantIds: string[];
  locationId?: string;
  salience: number;
  status: "active" | "superseded" | "contested";
  recallCues?: string[];
  occurredAt: string;
}

export interface MemoryRecallQuery {
  query?: string;
  participantIds?: string[];
  locationId?: string;
  now?: string;
  contextTags?: string[];
}

export interface MemoryRecall {
  atoms: MemoryAtom[];
  episodes: EpisodeMemory[];
}

export interface MemoryConsolidationTask {
  id: string;
  sessionId: string;
  characterId: string;
  trigger: "battle_aftermath" | "important_dialogue";
  sourceEvidenceIds: string[];
  participantIds: string[];
  locationId?: string;
  status: "pending" | "processing" | "completed" | "ignored" | "failed";
  attempts: number;
  createdAt: string;
  availableAt?: string;
  leasedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface RelationshipUpdateProposal {
  targetId: string;
  summary: string;
  trustDelta: number;
  confidence: number;
}

/** A bounded L2 proposal. It is a review artifact, not live CIF state. */
export interface CifPatternProposal {
  shouldPropose: boolean;
  characterId: string;
  sourceEpisodeIds: string[];
  relationship?: { targetId: string; content: string; confidence: number };
  belief?: { proposition: string; status: EpistemicStatus; confidence: number };
  recurringGoal?: { content: string; confidence: number };
  rationale?: string;
}

export interface CifPatternDraft {
  id: string;
  sessionId: string;
  characterId: string;
  triggerEpisodeId: string;
  status: "no_change" | "pending_review" | "pending_audit" | "invalid" | "approved" | "deferred" | "rejected" | "published";
  proposal: CifPatternProposal;
  validationErrors: string[];
  audit?: CognitiveAuditVerdict;
  generator: string;
  createdAt: string;
  reviewedAt?: string;
  publishedAt?: string;
}

/** A frozen, versioned proposal to refine one existing long-term CIF section. */
export interface CifL3RevisionDraft {
  id: string;
  sessionId: string;
  characterId: string;
  triggerEpisodeId: string;
  status: "no_change" | "pending_audit" | "invalid" | "approved" | "deferred" | "rejected" | "published";
  proposal: import("./revision.js").CifL3RevisionProposal;
  validationErrors: string[];
  audit?: CognitiveAuditVerdict;
  generator: string;
  createdAt: string;
  reviewedAt?: string;
  publishedAt?: string;
}

/** GM-visible continuity only: never includes a character's private appraisal. */
export interface SceneNarrativeProjection {
  id: string;
  sessionId: string;
  sourceEventIds: string[];
  participantIds: string[];
  locationId?: string;
  publicSummary: string;
  openThreads: string[];
  storyPressures: string[];
  createdAt: string;
}

export interface EpistemicState {
  id: string;
  sessionId: string;
  characterId: string;
  proposition: string;
  status: EpistemicStatus;
  confidence: number;
  supportingEvidenceIds: string[];
  opposingEvidenceIds: string[];
  version: number;
}

export interface InterpretiveModel {
  id: string;
  sessionId: string;
  characterId: string;
  kind: "belief" | "social";
  targetId?: string;
  content: string;
  activation: number;
  supportingEvidenceIds: string[];
  opposingEvidenceIds: string[];
  scope?: string;
  stability?: "temporary" | "moderate" | "stable";
  exceptions?: string[];
  changeConditions?: string[];
  predictedBehavior?: string;
  perceivedValues?: string[];
  perceivedFears?: string[];
  believedViewOfSelf?: string;
  expectedActions?: string[];
  fearedActions?: string[];
  revisionConditions?: string[];
  version: number;
}

export interface CharacterRuntimeState {
  sessionId: string;
  characterId: string;
  attention: string[];
  emotions: Array<{ type: string; intensity: number; targetId?: string }>;
  activeGoals: string[];
  locationId?: string;
  availability?: "free" | "busy" | "blocked";
  currentIntention?: string;
  currentPlan?: string;
  expressionStrategy?: string;
  /** Authoritative game-time marker used to rate-limit autonomous openers. */
  lastProactiveInteractionTick?: number;
  /** Last player location personally learned by this character; absence is not omniscience. */
  knownPlayerLocationId?: string;
  /** Explicit opt-in for ordinary, non-special ability attempts to approach the player. */
  approachPlayer?: "when_safe";
  updatedAt: string;
}

/**
 * A compact, query-friendly projection of the live CIF state used on the
 * appearance hot path. It is updated by initialization and later
 * consolidation; Story Director never has to reinterpret the whole profile.
 */
export interface CharacterAppearanceFactors {
  sessionId: string;
  characterId: string;
  activeGoals: string[];
  /** Story-signal tags such as `player_in_danger` mapped to a score delta. */
  responseWeights: Record<string, number>;
  /** A target entity id (usually `player`) mapped to a score delta. */
  relationshipWeights: Record<string, number>;
  availability: "free" | "busy" | "blocked";
  updatedAt: string;
}

export interface CharacterContext {
  characterId: string;
  profile?: CharacterProfile;
  capabilities?: CharacterCapability[];
  lifeContext?: CharacterLifeContext;
  objectiveRelationships?: ObjectiveRelationship[];
  identity: IdentityModel[];
  runtimeState: CharacterRuntimeState;
  evidence: EvidenceRecord[];
  memoryAtoms: MemoryAtom[];
  episodeMemories: EpisodeMemory[];
  epistemicStates: EpistemicState[];
  interpretiveModels: InterpretiveModel[];
}
