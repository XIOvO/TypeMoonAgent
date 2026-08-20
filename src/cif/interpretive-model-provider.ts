import type { InterpretiveModel } from "./types.js";

export interface InterpretiveModelReader {
  listInterpretiveModels(sessionId: string, characterId: string, limit: number, targetIds?: readonly string[]): InterpretiveModel[];
}

export interface InterpretiveModelProvider {
  getModels(request: { sessionId: string; characterId: string; limit?: number; targetIds?: readonly string[] }): Promise<readonly InterpretiveModel[]>;
}

/** Read-only provider; reader ownership determines the latest live model version. */
export class ReaderInterpretiveModelProvider implements InterpretiveModelProvider {
  public constructor(private readonly reader: InterpretiveModelReader) {}
  public async getModels(request: { sessionId: string; characterId: string; limit?: number; targetIds?: readonly string[] }): Promise<readonly InterpretiveModel[]> {
    return this.reader.listInterpretiveModels(request.sessionId, request.characterId, request.limit ?? 5, request.targetIds);
  }
}
