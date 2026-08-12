import type { CharacterContext, CharacterRuntimeState } from "./types.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

export interface CharacterContextOptions {
  evidenceLimit?: number;
  epistemicLimit?: number;
  interpretiveLimit?: number;
}

/** Selects the smallest useful CIF slice before Pi is invoked for a turn. */
export class CharacterContextBuilder {
  public constructor(private readonly repository: SqliteCifRepository) {}

  public build(sessionId: string, characterId: string, options: CharacterContextOptions = {}): CharacterContext {
    const runtimeState = this.repository.getRuntimeState(sessionId, characterId) ?? this.emptyRuntimeState(sessionId, characterId);
    return {
      characterId,
      identity: this.repository.listIdentity(sessionId, characterId),
      runtimeState,
      evidence: this.repository.listEvidence(sessionId, characterId, options.evidenceLimit ?? 3),
      epistemicStates: this.repository.listEpistemicStates(sessionId, characterId, options.epistemicLimit ?? 5),
      interpretiveModels: this.repository.listInterpretiveModels(sessionId, characterId, options.interpretiveLimit ?? 4),
    };
  }

  private emptyRuntimeState(sessionId: string, characterId: string): CharacterRuntimeState {
    return { sessionId, characterId, attention: [], emotions: [], activeGoals: [], updatedAt: new Date(0).toISOString() };
  }
}
