import { DatabaseSync } from "node:sqlite";
import type { ScriptChunkInput, ScriptDocumentInput, ScriptSearchResult } from "./types.js";

type Row = Record<string, unknown>;
const asJson = (value: unknown): string => JSON.stringify(value);
const fromJson = <T>(value: unknown): T => JSON.parse(String(value)) as T;

/** Read-only canon evidence index. It is intentionally separate from game saves. */
export class SqliteLoreRepository {
  private readonly db: DatabaseSync;

  public constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS script_documents (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, region TEXT NOT NULL, script_id TEXT NOT NULL,
        war_id INTEGER, quest_id INTEGER, quest_name TEXT, phase INTEGER,
        source_url TEXT NOT NULL, local_path TEXT NOT NULL, content_sha1 TEXT NOT NULL,
        source_sha1 TEXT, byte_size INTEGER NOT NULL, fetched_at TEXT NOT NULL,
        UNIQUE(source, region, script_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS script_chunks (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES script_documents(id) ON DELETE CASCADE,
        chunk_order INTEGER NOT NULL, text TEXT NOT NULL, speaker_names_json TEXT NOT NULL,
        character_count INTEGER NOT NULL, UNIQUE(document_id, chunk_order)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS script_chunks_by_document ON script_chunks(document_id, chunk_order);
      CREATE INDEX IF NOT EXISTS script_documents_by_war ON script_documents(region, war_id, quest_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS script_chunks_fts USING fts5(
        id UNINDEXED, document_id UNINDEXED, text, speaker_names,
        tokenize='trigram'
      );
    `);
  }

  public close(): void { this.db.close(); }

  public transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  public replaceDocument(document: ScriptDocumentInput, chunks: ScriptChunkInput[]): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM script_chunks_fts WHERE document_id = ?").run(document.id);
      this.db.prepare("DELETE FROM script_chunks WHERE document_id = ?").run(document.id);
      this.db.prepare(`INSERT INTO script_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET source_url = excluded.source_url, local_path = excluded.local_path,
        content_sha1 = excluded.content_sha1, source_sha1 = excluded.source_sha1, byte_size = excluded.byte_size,
        fetched_at = excluded.fetched_at, war_id = excluded.war_id, quest_id = excluded.quest_id,
        quest_name = excluded.quest_name, phase = excluded.phase`
      ).run(document.id, document.source, document.region, document.scriptId, document.warId ?? null,
        document.questId ?? null, document.questName ?? null, document.phase ?? null, document.sourceUrl,
        document.localPath, document.contentSha1, document.sourceSha1 ?? null, document.byteSize, document.fetchedAt);
      const insertChunk = this.db.prepare("INSERT INTO script_chunks VALUES (?, ?, ?, ?, ?, ?)");
      const insertFts = this.db.prepare("INSERT INTO script_chunks_fts VALUES (?, ?, ?, ?)");
      for (const chunk of chunks) {
        insertChunk.run(chunk.id, chunk.documentId, chunk.chunkOrder, chunk.text, asJson(chunk.speakerNames), chunk.text.length);
        insertFts.run(chunk.id, chunk.documentId, chunk.text, chunk.speakerNames.join(" "));
      }
    });
  }

  public countDocuments(): number { return Number((this.db.prepare("SELECT COUNT(*) AS count FROM script_documents").get() as Row).count); }
  public countChunks(): number { return Number((this.db.prepare("SELECT COUNT(*) AS count FROM script_chunks").get() as Row).count); }

  /** Uses FTS for three-plus-character queries; short CJK names safely fall back to a substring query. */
  public search(query: string, limit = 5, filters: { region?: string; warId?: number; maxQuestId?: number; speaker?: string } = {}): ScriptSearchResult[] {
    const normalized = query.trim();
    if (!normalized || limit < 1) return [];
    const where: string[] = [];
    const values: Array<string | number> = [];
    if (filters.region) { where.push("d.region = ?"); values.push(filters.region); }
    if (filters.warId !== undefined) { where.push("d.war_id = ?"); values.push(filters.warId); }
    if (filters.maxQuestId !== undefined) { where.push("d.quest_id <= ?"); values.push(filters.maxQuestId); }
    if (filters.speaker) { where.push("c.speaker_names_json LIKE ?"); values.push(`%${filters.speaker}%`); }
    const filterSql = where.length ? ` AND ${where.join(" AND ")}` : "";
    const fts = normalized.length >= 3;
    const sql = fts
      ? `SELECT c.*, d.script_id, d.war_id, d.quest_id, d.quest_name, 'fts' AS match_kind
         FROM script_chunks_fts f JOIN script_chunks c ON c.id = f.id JOIN script_documents d ON d.id = c.document_id
         WHERE script_chunks_fts MATCH ?${filterSql} ORDER BY bm25(script_chunks_fts) LIMIT ?`
      : `SELECT c.*, d.script_id, d.war_id, d.quest_id, d.quest_name, 'substring' AS match_kind
         FROM script_chunks c JOIN script_documents d ON d.id = c.document_id
         WHERE (c.text LIKE ? OR c.speaker_names_json LIKE ?)${filterSql} ORDER BY d.quest_id, c.chunk_order LIMIT ?`;
    const parameters = fts ? [normalized, ...values, limit] : [`%${normalized}%`, `%${normalized}%`, ...values, limit];
    return this.db.prepare(sql).all(...parameters).map((row) => this.searchResult(row as Row));
  }

  private searchResult(row: Row): ScriptSearchResult {
    return {
      id: String(row.id), documentId: String(row.document_id), scriptId: String(row.script_id),
      warId: row.war_id === null ? undefined : Number(row.war_id), questId: row.quest_id === null ? undefined : Number(row.quest_id),
      questName: row.quest_name === null ? undefined : String(row.quest_name), chunkOrder: Number(row.chunk_order),
      text: String(row.text), speakerNames: fromJson<string[]>(row.speaker_names_json), matchKind: row.match_kind as ScriptSearchResult["matchKind"],
    };
  }
}
