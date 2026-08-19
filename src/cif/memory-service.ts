import { randomUUID } from "node:crypto";
import type { EpisodeMemory, EvidenceRecord, MemoryAtom, MemoryRecall, MemoryRecallQuery } from "./types.js";

/** Minimal CIF storage required to validate, persist, and recall memories. */
export interface CharacterMemoryStore {
  transaction<T>(operation: () => T): T;
  listEvidenceByIds(sessionId: string, characterId: string, ids: readonly string[]): EvidenceRecord[];
  saveMemoryAtom(atom: MemoryAtom): void;
  saveEpisodeMemory(memory: EpisodeMemory): void;
  listMemoryAtoms(sessionId: string, characterId: string): MemoryAtom[];
  listEpisodeMemories(sessionId: string, characterId: string): EpisodeMemory[];
}

export interface MemoryConsolidationInput {
  sessionId: string;
  characterId: string;
  sourceEvidenceIds: string[];
  summary?: string;
  subjectiveInterpretation?: string;
  emotions?: EpisodeMemory["emotions"];
  participantIds?: string[];
  locationId?: string;
  salience: number;
  occurredAt: string;
}

/**
 * Deterministic v0.3 memory foundation. A future low-frequency model may
 * propose the summary and appraisal, but this service owns provenance checks
 * and persistence so no generated statement can become an untraceable memory.
 */
export class CharacterMemoryService {
  public constructor(private readonly repository: CharacterMemoryStore) {}

  public consolidate(input: MemoryConsolidationInput): EpisodeMemory {
    return this.repository.transaction(() => this.consolidateInTransaction(input));
  }

  /** Caller owns the surrounding transaction when memory must commit with other projections. */
  public consolidateInTransaction(input: MemoryConsolidationInput): EpisodeMemory {
    const evidence = this.repository.listEvidenceByIds(input.sessionId, input.characterId, input.sourceEvidenceIds);
    if (evidence.length !== new Set(input.sourceEvidenceIds).size) throw new Error("memory_sources_not_visible_to_character");
    if (!input.sourceEvidenceIds.length) throw new Error("memory_requires_evidence");

    const atoms = evidence.map((record) => this.atomFromEvidence(input, record));
    const sourceEventIds = unique(evidence.flatMap((record) => record.sourceEventIds));
    const participants = unique(input.participantIds ?? []);
    const episode: EpisodeMemory = {
      id: randomUUID(), sessionId: input.sessionId, ownerId: input.characterId,
      sourceEventIds, factualAnchorIds: atoms.map((atom) => atom.id),
      summary: input.summary?.trim() || evidence.map((record) => record.content).join(" "),
      subjectiveInterpretation: input.subjectiveInterpretation?.trim() || undefined,
      emotions: input.emotions ?? [], participantIds: participants, locationId: input.locationId,
      recallCues: unique(evidence.flatMap((record) => record.recallCues ?? [])),
      salience: bounded(input.salience), status: "active", occurredAt: input.occurredAt,
    };
    for (const atom of atoms) this.repository.saveMemoryAtom(atom);
    this.repository.saveEpisodeMemory(episode);
    return episode;
  }

  public recall(sessionId: string, characterId: string, query: MemoryRecallQuery = {}, limits: { atoms?: number; episodes?: number } = {}): MemoryRecall {
    const now = Date.parse(query.now ?? new Date().toISOString());
    const score = <T extends { content?: string; summary?: string; subjectiveInterpretation?: string; participantIds: string[]; locationId?: string; recallCues?: string[]; importance?: number; salience?: number; occurredAt: string }>(item: T): number => {
      const text = [item.content, item.summary, item.subjectiveInterpretation, ...item.participantIds, item.locationId, ...(item.recallCues ?? [])].filter(Boolean).join(" ");
      const relevance = textRelevance(query.query, text);
      const participant = query.participantIds?.some((id) => item.participantIds.includes(id)) ? 1 : 0;
      const location = query.locationId && query.locationId === item.locationId ? 1 : 0;
      const ageDays = Math.max(0, (now - Date.parse(item.occurredAt)) / 86_400_000);
      const recency = Math.exp(-ageDays / 180);
      const tag = query.contextTags?.some((value) => item.recallCues?.includes(value)) ? 1 : 0;
      return relevance * 0.4 + (item.importance ?? item.salience ?? 0) * 0.25 + recency * 0.15 + participant * 0.1 + location * 0.05 + tag * 0.05;
    };
    const atoms = this.repository.listMemoryAtoms(sessionId, characterId).sort((a, b) => score(b) - score(a)).slice(0, limits.atoms ?? 3);
    const episodes = this.repository.listEpisodeMemories(sessionId, characterId).filter((memory) => memory.status === "active")
      .sort((a, b) => score(b) - score(a)).slice(0, limits.episodes ?? 2);
    return { atoms, episodes };
  }

  private atomFromEvidence(input: MemoryConsolidationInput, evidence: EvidenceRecord): MemoryAtom {
    return {
      id: randomUUID(), sessionId: input.sessionId, ownerId: input.characterId, content: evidence.content,
      kind: evidence.kind === "testimony" ? "testimony" : evidence.kind === "inference" ? "inference" : "observed_fact",
      sourceEventIds: evidence.sourceEventIds, participantIds: unique(input.participantIds ?? []), locationId: input.locationId,
      recallCues: evidence.recallCues, confidence: bounded(evidence.reliability), importance: bounded(evidence.importance), occurredAt: evidence.occurredAt,
    };
  }
}

function bounded(value: number): number { return Math.max(0, Math.min(1, value)); }
function unique(values: string[]): string[] { return [...new Set(values)]; }

function textRelevance(query: string | undefined, text: string): number {
  if (!query?.trim()) return 0;
  const terms = [...new Set(query.toLowerCase().replace(/\s+/g, "").split(""))];
  if (!terms.length) return 0;
  const haystack = text.toLowerCase();
  return terms.filter((term) => haystack.includes(term)).length / terms.length;
}
