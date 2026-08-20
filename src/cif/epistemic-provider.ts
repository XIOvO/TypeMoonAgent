import type { EpistemicState, EpistemicStatus } from "./types.js";

export type PublicEpistemicStatus = "known" | "believed" | "suspected" | "unknown";

export interface PublicEpistemicState {
  proposition: string;
  confidence: number;
  status: PublicEpistemicStatus;
  evidenceIds: readonly string[];
  version: number;
}

export interface EpistemicReader {
  listEpistemicStates(sessionId: string, characterId: string, limit: number): EpistemicState[];
}

export interface EpistemicProvider {
  getStates(request: { sessionId: string; characterId: string; limit?: number }): Promise<readonly PublicEpistemicState[]>;
}

/** Read-only projection of CIF certainty levels for public capability consumers. */
export class ReaderEpistemicProvider implements EpistemicProvider {
  public constructor(private readonly reader: EpistemicReader) {}

  public async getStates(request: { sessionId: string; characterId: string; limit?: number }): Promise<readonly PublicEpistemicState[]> {
    return this.reader.listEpistemicStates(request.sessionId, request.characterId, request.limit ?? 5).map((state) => ({
      proposition: state.proposition, confidence: state.confidence, status: publicStatus(state.status),
      evidenceIds: state.supportingEvidenceIds, version: state.version,
    }));
  }
}

export function publicStatus(status: EpistemicStatus): PublicEpistemicStatus {
  if (status === "accepted") return "known";
  if (status === "likely") return "believed";
  if (status === "possible" || status === "uncertain" || status === "contested") return "suspected";
  return "unknown";
}
