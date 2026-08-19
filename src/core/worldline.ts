/** Player-world facts are authoritative projections of confirmed L0 events. */
import type { GameEvent } from "./contracts.js";

export interface BranchEventProjector {
  project(events: readonly GameEvent[]): void;
}

export interface BranchFact {
  id: string;
  sessionId: string;
  factKey: string;
  value: Record<string, unknown>;
  sourceEventIds: string[];
  updatedAt: string;
}

export type BranchProgressStatus = "locked" | "available" | "active" | "completed" | "assumed" | "skipped" | "diverted" | "blocked";

/** One content line per player: completed/diverted/blocked nodes are retained as history. */
export interface BranchProgress {
  sessionId: string;
  playerId: string;
  contentType: "main" | "event" | "interlude" | "original";
  contentId: string;
  activeNodeId?: string;
  status: BranchProgressStatus;
  completedNodeIds: string[];
  divertedNodeIds: string[];
  blockedNodeIds: string[];
  updatedAt: string;
}

export interface SessionStoryContext {
  sessionId: string;
  playerId: string;
  /** The canon point used to scope character/lore access; it never overwrites branch facts. */
  canonAnchor: string;
  checkpointNodeId?: string;
  checkpointRevision: number;
  updatedAt: string;
}

export interface WorldlineDivergence {
  id: string;
  sessionId: string;
  canonAnchor: string;
  sourceEventIds: string[];
  changedFactKey: string;
  canonBaseline: Record<string, unknown>;
  branchReality: Record<string, unknown>;
  significance: "minor" | "major" | "critical";
  affectedScope: "local" | "chapter" | "future" | "global";
  knownImpactNodeIds: string[];
  pendingImpactChapterIds: string[];
  status: "active" | "resolved" | "superseded";
  rationale: string;
  createdAt: string;
  updatedAt: string;
}

/** Serializable, chapter-local rules. Future importers may generate this shape from canon fragments. */
export interface ChapterEventMatcher {
  type: GameEvent["type"];
  payloadEquals?: Record<string, string | number | boolean>;
}

export interface ChapterFactRequirement {
  factKey: string;
  valueEquals: Record<string, unknown>;
}

export interface ChapterNodeTransition {
  status: BranchProgressStatus;
  activeNodeId?: string;
  completeNodeIds?: string[];
  divertNodeIds?: string[];
  blockNodeIds?: string[];
}

/** A deterministic opening requirement shared by main, event, and other chapter packages. */
export interface ChapterNodeSummon {
  characterId: string;
  reason: string;
}

export interface ChapterNodeRuleDefinition {
  id: string;
  when: ChapterEventMatcher;
  requiresFacts?: ChapterFactRequirement[];
  transition: ChapterNodeTransition;
  /** While this node is active, its named character must open it before it can advance. */
  summon?: ChapterNodeSummon;
  fact?: {
    factKey: string;
    value: Record<string, unknown>;
    canonBaseline?: Record<string, unknown>;
    divergence?: Omit<WorldlineDivergence, "id" | "sessionId" | "canonAnchor" | "sourceEventIds" | "changedFactKey" | "canonBaseline" | "branchReality" | "createdAt" | "updatedAt">;
  };
}

type ChapterAssessmentScalar = string | number | boolean;

/** Explicit authority for facts an AI assessor may propose within one chapter. */
export interface ChapterAssessmentFactPolicy {
  factKey: string;
  allowedValue: Record<string, readonly ChapterAssessmentScalar[]>;
  allowedCanonBaseline: Record<string, readonly ChapterAssessmentScalar[]>;
  allowedEventTypes: readonly GameEvent["type"][];
  allowedCanonSourceFragmentIds: readonly string[];
  allowedSignificances: readonly WorldlineDivergence["significance"][];
  allowedAffectedScopes: readonly WorldlineDivergence["affectedScope"][];
  allowedKnownImpactNodeIds: readonly string[];
  allowedPendingImpactChapterIds: readonly string[];
}

export interface StoryChapterPackage {
  packageId: string;
  contentType: BranchProgress["contentType"];
  contentId: string;
  canonAnchor: string;
  entryNodeId: string;
  sourceFragmentIds: string[];
  nodeRules: ChapterNodeRuleDefinition[];
  /** Omitted means AI assessment may not create branch facts for this chapter. */
  assessmentPolicies?: ChapterAssessmentFactPolicy[];
  version: number;
}

export interface PersistedStoryChapterPackage extends StoryChapterPackage {
  sessionId: string;
  status: "active" | "inactive" | "invalidated";
  activatedAt: string;
  invalidatedAt?: string;
}
