import type { CharacterContext, IdentitySection, MemoryRecallQuery } from "./types.js";
import type { CharacterContextBuilder } from "./context-builder.js";

export interface ContextBudget {
  maxMemoryItems?: number;
  maxEvidenceItems?: number;
  maxRelationshipItems?: number;
  /** Rejected until a deterministic token estimator is introduced. */
  maxEstimatedTokens?: number;
}

export interface CharacterContextRequest {
  sessionId: string;
  characterId: string;
  participantIds?: readonly string[];
  memoryQuery?: MemoryRecallQuery;
  additionalIdentitySections?: readonly IdentitySection[];
  budget?: ContextBudget;
}

/** Public read-only CIF context capability; it never exposes a repository. */
export interface CharacterContextProvider {
  build(request: CharacterContextRequest): Promise<CharacterContext>;
}

/** Adapts the existing builder without duplicating any CIF selection logic. */
export class BuilderCharacterContextProvider implements CharacterContextProvider {
  public constructor(private readonly builder: Pick<CharacterContextBuilder, "build">) {}

  public async build(request: CharacterContextRequest): Promise<CharacterContext> {
    const budget = request.budget;
    if (budget?.maxEstimatedTokens !== undefined) throw new Error("character_context_token_budget_unsupported");
    const evidenceLimit = checkedLimit(budget?.maxEvidenceItems);
    const memoryLimit = checkedLimit(budget?.maxMemoryItems);
    const relationshipLimit = checkedLimit(budget?.maxRelationshipItems);
    const context = this.builder.build(request.sessionId, request.characterId, {
      participantIds: request.participantIds,
      memoryQuery: request.memoryQuery,
      additionalIdentitySections: request.additionalIdentitySections,
      ...(evidenceLimit === undefined ? {} : { evidenceLimit }),
    });
    const [memoryAtoms, episodeMemories] = trimMemory(context, memoryLimit);
    return {
      ...context,
      memoryAtoms,
      episodeMemories,
      objectiveRelationships: relationshipLimit === undefined
        ? context.objectiveRelationships
        : context.objectiveRelationships?.slice(0, relationshipLimit),
    };
  }
}

function checkedLimit(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("character_context_budget_invalid");
  return value;
}

function trimMemory(context: CharacterContext, limit: number | undefined): [CharacterContext["memoryAtoms"], CharacterContext["episodeMemories"]] {
  if (limit === undefined) return [context.memoryAtoms, context.episodeMemories];
  const memoryAtoms = context.memoryAtoms.slice(0, limit);
  return [memoryAtoms, context.episodeMemories.slice(0, limit - memoryAtoms.length)];
}
