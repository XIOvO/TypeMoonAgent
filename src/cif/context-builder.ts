import type { CharacterContext, CharacterRuntimeState, IdentitySection, MemoryRecallQuery } from "./types.js";
import { CharacterMemoryService } from "./memory-service.js";
import { SqliteCifRepository } from "./sqlite-repository.js";
import type { CifContextTag } from "./context-tags.js";
import { CORE_IDENTITY_SECTIONS, identitySectionsForContextTags, uniqueIdentitySections } from "./identity-sections.js";
export { CORE_IDENTITY_SECTIONS } from "./identity-sections.js";

export interface CharacterContextOptions {
  evidenceLimit?: number;
  epistemicLimit?: number;
  interpretiveLimit?: number;
  memoryQuery?: MemoryRecallQuery;
  /** Extra CIF sections justified by a known scene trigger, such as a major commitment test. */
  additionalIdentitySections?: readonly IdentitySection[];
  /** Current visible entities; social models outside this set stay out of the prompt. */
  participantIds?: readonly string[];
}

/** Selects the smallest useful CIF slice before Pi is invoked for a turn. */
export class CharacterContextBuilder {
  private readonly memories: CharacterMemoryService;

  public constructor(private readonly repository: SqliteCifRepository) {
    this.memories = new CharacterMemoryService(repository);
  }

  public build(sessionId: string, characterId: string, options: CharacterContextOptions = {}): CharacterContext {
    const runtimeState = this.repository.getRuntimeState(sessionId, characterId) ?? this.emptyRuntimeState(sessionId, characterId);
    const evidence = this.repository.listEvidence(sessionId, characterId, options.evidenceLimit ?? 3);
    const contextTags = evidence
      .filter((item) => item.sourceType === "world_event" && item.verifiedStatus === "verified")
      .flatMap((item) => item.recallCues ?? []) as CifContextTag[];
    const memories = this.memories.recall(sessionId, characterId, { ...options.memoryQuery, contextTags });
    return {
      characterId,
      profile: this.repository.getProfile(sessionId, characterId),
      capabilities: this.repository.listCapabilities(sessionId, characterId),
      lifeContext: this.repository.getLifeContext(sessionId, characterId),
      objectiveRelationships: this.repository.listObjectiveRelationships(sessionId, characterId)
        .filter((item) => !options.participantIds?.length || options.participantIds.includes(item.targetId)),
      identity: this.repository.listIdentity(sessionId, characterId, uniqueIdentitySections([...CORE_IDENTITY_SECTIONS, ...identitySectionsForContextTags(contextTags), ...(options.additionalIdentitySections ?? [])])),
      runtimeState,
      evidence,
      memoryAtoms: memories.atoms,
      episodeMemories: memories.episodes,
      epistemicStates: this.repository.listEpistemicStates(sessionId, characterId, options.epistemicLimit ?? 5),
      interpretiveModels: this.repository.listInterpretiveModels(sessionId, characterId, options.interpretiveLimit ?? 4, options.participantIds),
    };
  }

  private emptyRuntimeState(sessionId: string, characterId: string): CharacterRuntimeState {
    return { sessionId, characterId, attention: [], emotions: [], activeGoals: [], updatedAt: new Date(0).toISOString() };
  }
}
