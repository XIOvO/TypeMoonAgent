import type { CharacterMemoryService } from "./memory-service.js";
import type { MemoryRecall, MemoryRecallQuery } from "./types.js";

export interface CharacterMemoryRecallRequest {
  sessionId: string;
  characterId: string;
  query?: MemoryRecallQuery;
  limits?: { atoms?: number; episodes?: number };
}

/** Public read-only memory capability; storage remains behind CharacterMemoryService. */
export interface CharacterMemoryProvider {
  recall(request: CharacterMemoryRecallRequest): Promise<MemoryRecall>;
}

export class ServiceCharacterMemoryProvider implements CharacterMemoryProvider {
  public constructor(private readonly memories: Pick<CharacterMemoryService, "recall">) {}

  public async recall(request: CharacterMemoryRecallRequest): Promise<MemoryRecall> {
    return this.memories.recall(request.sessionId, request.characterId, request.query, request.limits);
  }
}
