/** CIF v0.2 data types persisted outside the LLM context. */
export type EpistemicStatus =
  | "accepted"
  | "likely"
  | "possible"
  | "uncertain"
  | "contested"
  | "rejected"
  | "unknown"
  | "outdated";

export type IdentitySection =
  | "self_model"
  | "core_schema"
  | "needs"
  | "values"
  | "possible_self"
  | "dream"
  | "commitment";

export interface IdentityModel {
  id: string;
  sessionId: string;
  characterId: string;
  section: IdentitySection;
  content: string;
  sourceIds: string[];
  version: number;
}

export interface EvidenceRecord {
  id: string;
  sessionId: string;
  characterId: string;
  kind: "observation" | "episode" | "testimony" | "learned" | "inference";
  content: string;
  sourceEventIds: string[];
  reliability: number;
  importance: number;
  occurredAt: string;
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
  version: number;
}

export interface CharacterRuntimeState {
  sessionId: string;
  characterId: string;
  attention: string[];
  emotions: Array<{ type: string; intensity: number; targetId?: string }>;
  activeGoals: string[];
  currentPlan?: string;
  expressionStrategy?: string;
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
  identity: IdentityModel[];
  runtimeState: CharacterRuntimeState;
  evidence: EvidenceRecord[];
  epistemicStates: EpistemicState[];
  interpretiveModels: InterpretiveModel[];
}
