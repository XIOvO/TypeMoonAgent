import { DatabaseSync } from "node:sqlite";
import type {
  CanonCharacterInput, CanonDocumentBundle, CanonLocationInput, CanonStoryCollectionInput,
  CanonServantProfileEntryInput, CanonServantProfileInput, CanonStoryNodeInput, CanonStoryPhaseInput, ScriptSearchResult, ServantProfileEvidence,
} from "./types.js";

type Row = Record<string, unknown>;
const asJson = (value: unknown): string => JSON.stringify(value);
const fromJson = <T>(value: unknown): T => JSON.parse(String(value)) as T;

/**
 * Read-only canon evidence index.  It owns imported source structure and never owns player progress.
 * Binary art/audio assets intentionally belong outside this database.
 */
export class SqliteLoreRepository {
  private readonly db: DatabaseSync;

  public constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS canon_story_collections (
        id TEXT PRIMARY KEY, region TEXT NOT NULL, atlas_war_id INTEGER NOT NULL,
        content_kind TEXT NOT NULL CHECK(content_kind IN ('main','interlude','event')),
        name TEXT NOT NULL, long_name TEXT, atlas_event_id INTEGER,
        UNIQUE(region, atlas_war_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_locations (
        id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES canon_story_collections(id) ON DELETE CASCADE,
        atlas_spot_id INTEGER NOT NULL, name TEXT NOT NULL, atlas_map_id INTEGER,
        UNIQUE(collection_id, atlas_spot_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_story_nodes (
        id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES canon_story_collections(id) ON DELETE CASCADE,
        location_id TEXT REFERENCES canon_locations(id) ON DELETE SET NULL, atlas_quest_id INTEGER NOT NULL,
        name TEXT NOT NULL, quest_type TEXT NOT NULL, chapter_id INTEGER, chapter_sub_id INTEGER,
        chapter_sub_title TEXT, content_kind TEXT NOT NULL CHECK(content_kind IN ('main','interlude','event')),
        unlock_key TEXT NOT NULL, UNIQUE(collection_id, atlas_quest_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_story_phases (
        id TEXT PRIMARY KEY, story_node_id TEXT NOT NULL REFERENCES canon_story_nodes(id) ON DELETE CASCADE,
        phase INTEGER NOT NULL, script_ids_json TEXT NOT NULL, UNIQUE(story_node_id, phase)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_documents (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, region TEXT NOT NULL, script_id TEXT NOT NULL,
        story_node_id TEXT REFERENCES canon_story_nodes(id) ON DELETE SET NULL,
        phase_id TEXT REFERENCES canon_story_phases(id) ON DELETE SET NULL,
        content_kind TEXT NOT NULL CHECK(content_kind IN ('main','interlude','event','servant_profile')),
        source_url TEXT NOT NULL, local_path TEXT NOT NULL, content_sha1 TEXT NOT NULL, source_sha1 TEXT,
        byte_size INTEGER NOT NULL, fetched_at TEXT NOT NULL, UNIQUE(source, region, script_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_characters (
        id TEXT PRIMARY KEY, region TEXT NOT NULL, atlas_svt_id INTEGER, atlas_chara_id INTEGER,
        display_name TEXT NOT NULL, normalized_name TEXT NOT NULL,
        UNIQUE(region, normalized_name)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_servant_profiles (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL UNIQUE REFERENCES canon_documents(id) ON DELETE CASCADE,
        region TEXT NOT NULL, atlas_servant_id INTEGER NOT NULL, collection_no INTEGER,
        display_name TEXT NOT NULL, original_name TEXT, class_name TEXT, rarity INTEGER, gender TEXT, attribute TEXT,
        cv TEXT, illustrator TEXT, parameters_json TEXT NOT NULL, profile_json TEXT NOT NULL,
        UNIQUE(region, atlas_servant_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_servant_profile_entries (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES canon_servant_profiles(id) ON DELETE CASCADE,
        entry_order INTEGER NOT NULL, source_entry_id INTEGER, priority INTEGER NOT NULL,
        unlock_condition_json TEXT NOT NULL, text TEXT NOT NULL, UNIQUE(profile_id, entry_order)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_scenes (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES canon_documents(id) ON DELETE CASCADE,
        scene_order INTEGER NOT NULL, atlas_scene_id TEXT, raw_start_line INTEGER NOT NULL, raw_end_line INTEGER NOT NULL,
        UNIQUE(document_id, scene_order)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_scene_characters (
        scene_id TEXT NOT NULL REFERENCES canon_scenes(id) ON DELETE CASCADE,
        character_id TEXT NOT NULL REFERENCES canon_characters(id) ON DELETE CASCADE,
        slot TEXT, appearance_kind TEXT NOT NULL CHECK(appearance_kind IN ('chara_set','speaker')),
        display_name TEXT NOT NULL, PRIMARY KEY(scene_id, character_id, appearance_kind)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_dialogues (
        id TEXT PRIMARY KEY, scene_id TEXT NOT NULL REFERENCES canon_scenes(id) ON DELETE CASCADE,
        dialogue_order INTEGER NOT NULL, speaker_name TEXT,
        speaker_character_id TEXT REFERENCES canon_characters(id) ON DELETE SET NULL,
        text TEXT NOT NULL, raw_start_line INTEGER NOT NULL, raw_end_line INTEGER NOT NULL,
        UNIQUE(scene_id, dialogue_order)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canon_fragments (
        id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES canon_documents(id) ON DELETE CASCADE,
        scene_id TEXT REFERENCES canon_scenes(id) ON DELETE SET NULL, fragment_order INTEGER NOT NULL,
        text TEXT NOT NULL, speaker_names_json TEXT NOT NULL, dialogue_ids_json TEXT NOT NULL,
        spoiler_unlock_key TEXT NOT NULL, character_count INTEGER NOT NULL,
        UNIQUE(document_id, fragment_order)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS canon_nodes_by_collection ON canon_story_nodes(collection_id, atlas_quest_id);
      CREATE INDEX IF NOT EXISTS canon_documents_by_node ON canon_documents(story_node_id, phase_id);
      CREATE INDEX IF NOT EXISTS canon_dialogues_by_scene ON canon_dialogues(scene_id, dialogue_order);
      CREATE INDEX IF NOT EXISTS canon_appearances_by_character ON canon_scene_characters(character_id, scene_id);
      CREATE INDEX IF NOT EXISTS canon_servant_entries_by_profile ON canon_servant_profile_entries(profile_id, entry_order);
      CREATE VIRTUAL TABLE IF NOT EXISTS canon_fragments_fts USING fts5(
        id UNINDEXED, document_id UNINDEXED, text, speaker_names, tokenize='trigram'
      );
    `);
  }

  public close(): void { this.db.close(); }
  public transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  public upsertCollection(input: CanonStoryCollectionInput): void {
    this.db.prepare(`INSERT INTO canon_story_collections VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, long_name=excluded.long_name,
      content_kind=excluded.content_kind, atlas_event_id=excluded.atlas_event_id`)
      .run(input.id, input.region, input.atlasWarId, input.contentKind, input.name, input.longName ?? null, input.atlasEventId ?? null);
  }
  public upsertLocation(input: CanonLocationInput): void {
    this.db.prepare(`INSERT INTO canon_locations VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, atlas_map_id=excluded.atlas_map_id, collection_id=excluded.collection_id`)
      .run(input.id, input.collectionId, input.atlasSpotId, input.name, input.atlasMapId ?? null);
  }
  public upsertStoryNode(input: CanonStoryNodeInput): void {
    this.db.prepare(`INSERT INTO canon_story_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET collection_id=excluded.collection_id, location_id=excluded.location_id,
      name=excluded.name, quest_type=excluded.quest_type, chapter_id=excluded.chapter_id,
      chapter_sub_id=excluded.chapter_sub_id, chapter_sub_title=excluded.chapter_sub_title,
      content_kind=excluded.content_kind, unlock_key=excluded.unlock_key`)
      .run(input.id, input.collectionId, input.locationId ?? null, input.atlasQuestId, input.name, input.questType,
        input.chapterId ?? null, input.chapterSubId ?? null, input.chapterSubTitle ?? null, input.contentKind, input.unlockKey);
  }
  public upsertPhase(input: CanonStoryPhaseInput): void {
    this.db.prepare(`INSERT INTO canon_story_phases VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET story_node_id=excluded.story_node_id, phase=excluded.phase, script_ids_json=excluded.script_ids_json`)
      .run(input.id, input.storyNodeId, input.phase, asJson(input.scriptIds));
  }
  public upsertCharacter(input: CanonCharacterInput): void {
    this.db.prepare(`INSERT INTO canon_characters VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, normalized_name=excluded.normalized_name,
      atlas_svt_id=COALESCE(excluded.atlas_svt_id, canon_characters.atlas_svt_id),
      atlas_chara_id=COALESCE(excluded.atlas_chara_id, canon_characters.atlas_chara_id)`)
      .run(input.id, input.region, input.atlasSvtId ?? null, input.atlasCharaId ?? null, input.displayName, input.normalizedName);
  }
  public replaceServantProfile(input: CanonServantProfileInput, entries: CanonServantProfileEntryInput[]): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM canon_servant_profile_entries WHERE profile_id = ?").run(input.id);
      this.db.prepare(`INSERT INTO canon_servant_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET document_id=excluded.document_id, display_name=excluded.display_name,
        original_name=excluded.original_name, class_name=excluded.class_name, rarity=excluded.rarity, gender=excluded.gender,
        attribute=excluded.attribute, cv=excluded.cv, illustrator=excluded.illustrator, parameters_json=excluded.parameters_json,
        profile_json=excluded.profile_json`)
        .run(input.id, input.documentId, input.region, input.atlasServantId, input.collectionNo ?? null, input.displayName,
          input.originalName ?? null, input.className ?? null, input.rarity ?? null, input.gender ?? null, input.attribute ?? null,
          input.cv ?? null, input.illustrator ?? null, asJson(input.parameters), asJson(input.profileJson));
      const entry = this.db.prepare("INSERT INTO canon_servant_profile_entries VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const item of entries) entry.run(item.id, item.profileId, item.entryOrder, item.sourceEntryId ?? null, item.priority,
        asJson(item.unlockCondition), item.text);
    });
  }

  public replaceDocument(bundle: CanonDocumentBundle): void {
    this.transaction(() => {
      const { document } = bundle;
      this.db.prepare("DELETE FROM canon_fragments_fts WHERE document_id = ?").run(document.id);
      this.db.prepare("DELETE FROM canon_documents WHERE id = ?").run(document.id);
      this.db.prepare(`INSERT INTO canon_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET story_node_id=excluded.story_node_id, phase_id=excluded.phase_id,
        content_kind=excluded.content_kind, source_url=excluded.source_url, local_path=excluded.local_path,
        content_sha1=excluded.content_sha1, source_sha1=excluded.source_sha1, byte_size=excluded.byte_size, fetched_at=excluded.fetched_at`)
        .run(document.id, document.source, document.region, document.scriptId, document.storyNodeId ?? null, document.phaseId ?? null,
          document.contentKind, document.sourceUrl, document.localPath, document.contentSha1, document.sourceSha1 ?? null,
          document.byteSize, document.fetchedAt);
      const scene = this.db.prepare("INSERT INTO canon_scenes VALUES (?, ?, ?, ?, ?, ?)");
      const appearance = this.db.prepare("INSERT OR IGNORE INTO canon_scene_characters VALUES (?, ?, ?, ?, ?)");
      const dialogue = this.db.prepare("INSERT INTO canon_dialogues VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      for (const item of bundle.scenes) {
        scene.run(item.id, item.documentId, item.sceneOrder, item.atlasSceneId ?? null, item.rawStartLine, item.rawEndLine);
        for (const character of item.appearances) appearance.run(character.sceneId, character.characterId, character.slot ?? null, character.appearanceKind, character.displayName);
        for (const line of item.dialogues) dialogue.run(line.id, line.sceneId, line.dialogueOrder, line.speakerName ?? null,
          line.speakerCharacterId ?? null, line.text, line.rawStartLine, line.rawEndLine);
      }
      const fragment = this.db.prepare("INSERT INTO canon_fragments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const fragmentFts = this.db.prepare("INSERT INTO canon_fragments_fts VALUES (?, ?, ?, ?)");
      for (const item of bundle.fragments) {
        fragment.run(item.id, item.documentId, item.sceneId ?? null, item.fragmentOrder, item.text, asJson(item.speakerNames),
          asJson(item.dialogueIds), item.spoilerUnlockKey, item.text.length);
        fragmentFts.run(item.id, item.documentId, item.text, item.speakerNames.join(" "));
      }
    });
  }

  public countDocuments(): number { return this.countTable("canon_documents"); }
  public countChunks(): number { return this.countTable("canon_fragments"); }
  public countServantProfiles(): number { return this.countTable("canon_servant_profiles"); }
  public getFragmentsByIds(ids: readonly string[]): Array<{ id: string; text: string }> {
    if (!ids.length) return [];
    const placeholders = ids.map(() => "?").join(", ");
    const byId = new Map((this.db.prepare(`SELECT id, text FROM canon_fragments WHERE id IN (${placeholders})`).all(...ids) as Row[])
      .map((row) => [String(row.id), { id: String(row.id), text: String(row.text) }]));
    return ids.map((id) => byId.get(id)).filter((fragment): fragment is { id: string; text: string } => fragment !== undefined);
  }
  public hasDocumentContent(id: string, contentSha1: string): boolean {
    const row = this.db.prepare("SELECT content_sha1 FROM canon_documents WHERE id = ?").get(id) as Row | undefined;
    return row?.content_sha1 === contentSha1;
  }
  public count(table: "canon_story_collections" | "canon_locations" | "canon_story_nodes" | "canon_story_phases" | "canon_documents" | "canon_scenes" | "canon_dialogues" | "canon_fragments"): number {
    return this.countTable(table);
  }

  /** Existing CIF callers use this evidence-only query; spoiler keys are returned for their policy layer to enforce. */
  public search(query: string, limit = 5, filters: { region?: string; warId?: number; maxQuestId?: number; speaker?: string } = {}): ScriptSearchResult[] {
    const normalized = query.trim(); if (!normalized || limit < 1) return [];
    const where: string[] = []; const values: Array<string | number> = [];
    if (filters.region) { where.push("d.region = ?"); values.push(filters.region); }
    if (filters.warId !== undefined) { where.push("c.atlas_war_id = ?"); values.push(filters.warId); }
    if (filters.maxQuestId !== undefined) { where.push("n.atlas_quest_id <= ?"); values.push(filters.maxQuestId); }
    if (filters.speaker) { where.push("f.speaker_names_json LIKE ?"); values.push(`%${filters.speaker}%`); }
    const filterSql = where.length ? ` AND ${where.join(" AND ")}` : "";
    const joins = "JOIN canon_documents d ON d.id=f.document_id LEFT JOIN canon_story_nodes n ON n.id=d.story_node_id LEFT JOIN canon_story_collections c ON c.id=n.collection_id";
    const fts = normalized.length >= 3;
    const sql = fts
      ? `SELECT f.*, d.script_id, d.content_kind, n.atlas_quest_id, n.name AS quest_name, p.phase, c.atlas_war_id, 'fts' AS match_kind
         FROM canon_fragments_fts x JOIN canon_fragments f ON f.id=x.id ${joins} LEFT JOIN canon_story_phases p ON p.id=d.phase_id
         WHERE canon_fragments_fts MATCH ?${filterSql} ORDER BY bm25(canon_fragments_fts) LIMIT ?`
      : `SELECT f.*, d.script_id, d.content_kind, n.atlas_quest_id, n.name AS quest_name, p.phase, c.atlas_war_id, 'substring' AS match_kind
         FROM canon_fragments f ${joins} LEFT JOIN canon_story_phases p ON p.id=d.phase_id
         WHERE (f.text LIKE ? OR f.speaker_names_json LIKE ?)${filterSql} ORDER BY n.atlas_quest_id, f.fragment_order LIMIT ?`;
    const parameters = fts ? [normalized, ...values, limit] : [`%${normalized}%`, `%${normalized}%`, ...values, limit];
    return this.db.prepare(sql).all(...parameters).map((row) => this.searchResult(row as Row));
  }

  /** Raw profile evidence is returned with its source unlock condition; game policy decides visibility. */
  public listServantProfileEvidence(input: { region: string; names: string[]; limit?: number }): ServantProfileEvidence[] {
    const names = [...new Set(input.names.map((name) => name.trim()).filter(Boolean))]; if (!names.length) return [];
    const conditions = names.map(() => "(p.display_name LIKE ? OR COALESCE(p.original_name, '') LIKE ?)").join(" OR ");
    const values = names.flatMap((name) => [`%${name}%`, `%${name}%`]);
    const rows = this.db.prepare(`SELECT f.id, f.document_id, d.script_id, p.display_name, f.text, f.fragment_order, e.unlock_condition_json
      FROM canon_servant_profiles p JOIN canon_documents d ON d.id=p.document_id
      JOIN canon_fragments f ON f.document_id=p.document_id
      LEFT JOIN canon_servant_profile_entries e ON e.profile_id=p.id AND e.entry_order=f.fragment_order
      WHERE p.region = ? AND (${conditions}) AND (f.fragment_order = 0 OR e.id IS NOT NULL)
      ORDER BY p.collection_no, f.fragment_order LIMIT ?`).all(input.region, ...values, input.limit ?? 80) as Row[];
    return rows.map((row) => ({ id: String(row.id), documentId: String(row.document_id), scriptId: String(row.script_id),
      displayName: String(row.display_name), text: String(row.text), entryOrder: Number(row.fragment_order),
      unlockCondition: row.unlock_condition_json ? fromJson<Record<string, unknown>>(row.unlock_condition_json) : { type: "none" },
    }));
  }

  private countTable(table: string): number { return Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as Row).count); }
  private searchResult(row: Row): ScriptSearchResult {
    return {
      id: String(row.id), documentId: String(row.document_id), scriptId: String(row.script_id),
      warId: row.atlas_war_id === null ? undefined : Number(row.atlas_war_id), questId: row.atlas_quest_id === null ? undefined : Number(row.atlas_quest_id),
      questName: row.quest_name === null ? undefined : String(row.quest_name), phase: row.phase === null ? undefined : Number(row.phase),
      contentKind: row.content_kind as ScriptSearchResult["contentKind"], sceneId: row.scene_id === null ? undefined : String(row.scene_id),
      chunkOrder: Number(row.fragment_order), text: String(row.text), speakerNames: fromJson<string[]>(row.speaker_names_json),
      dialogueIds: fromJson<string[]>(row.dialogue_ids_json), spoilerUnlockKey: String(row.spoiler_unlock_key), matchKind: row.match_kind as ScriptSearchResult["matchKind"],
    };
  }
}
