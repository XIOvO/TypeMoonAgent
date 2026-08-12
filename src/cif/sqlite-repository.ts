import { DatabaseSync } from "node:sqlite";
import type {
  CharacterRuntimeState,
  CharacterAppearanceFactors,
  EpistemicState,
  EvidenceRecord,
  IdentityModel,
  InterpretiveModel,
} from "./types.js";
import type { CifInitializationDraftRecord } from "./initializer.js";
import type { GameState } from "../core/contracts.js";
import type { PlayerPrivateNote } from "../core/contracts.js";

type Row = Record<string, unknown>;
const asJson = (value: unknown): string => JSON.stringify(value);
const fromJson = <T>(value: unknown): T => JSON.parse(String(value)) as T;

/** SQLite repository: objective history is separate from each character's CIF view. */
export class SqliteCifRepository {
  private readonly db: DatabaseSync;

  public constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS objective_history (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(session_id, sequence)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS processed_actions (
        action_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_ids_json TEXT NOT NULL,
        state_revision INTEGER NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS session_world_states (
        session_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS player_private_notes (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, player_id TEXT NOT NULL,
        source_input_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(session_id, source_input_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_identity_models (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        section TEXT NOT NULL, content TEXT NOT NULL, source_ids_json TEXT NOT NULL,
        version INTEGER NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_evidence_records (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        kind TEXT NOT NULL, content TEXT NOT NULL, source_event_ids_json TEXT NOT NULL,
        reliability REAL NOT NULL, importance REAL NOT NULL, occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_epistemic_states (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        proposition TEXT NOT NULL, status TEXT NOT NULL, confidence REAL NOT NULL,
        supporting_evidence_ids_json TEXT NOT NULL, opposing_evidence_ids_json TEXT NOT NULL,
        version INTEGER NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_interpretive_models (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        kind TEXT NOT NULL, target_id TEXT, content TEXT NOT NULL, activation REAL NOT NULL,
        supporting_evidence_ids_json TEXT NOT NULL, opposing_evidence_ids_json TEXT NOT NULL,
        version INTEGER NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_runtime_states (
        session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        attention_json TEXT NOT NULL, emotions_json TEXT NOT NULL, active_goals_json TEXT NOT NULL,
        current_plan TEXT, expression_strategy TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY(session_id, character_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_appearance_factors (
        session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        active_goals_json TEXT NOT NULL, response_weights_json TEXT NOT NULL,
        relationship_weights_json TEXT NOT NULL, availability TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(session_id, character_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cif_initialization_drafts (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        variant_id TEXT NOT NULL, story_point_id TEXT NOT NULL, status TEXT NOT NULL,
        brief_json TEXT NOT NULL, draft_json TEXT NOT NULL, validation_errors_json TEXT NOT NULL,
        generator TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_at TEXT, published_at TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS evidence_by_character ON character_evidence_records(session_id, character_id, importance DESC);
      CREATE INDEX IF NOT EXISTS epistemic_by_character ON character_epistemic_states(session_id, character_id, confidence DESC);
      CREATE INDEX IF NOT EXISTS interpretive_by_character ON character_interpretive_models(session_id, character_id, activation DESC);
      CREATE INDEX IF NOT EXISTS cif_drafts_by_character ON cif_initialization_drafts(session_id, character_id, status, created_at DESC);
    `);
    this.ensureColumn("cif_initialization_drafts", "published_at", "TEXT");
  }

  public close(): void { this.db.close(); }

  public transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  public recordProcessedAction(input: { actionId: string; sessionId: string; eventIds: string[]; stateRevision: number; createdAt: string }): void {
    this.db.prepare("INSERT INTO processed_actions VALUES (?, ?, ?, ?, ?)").run(input.actionId, input.sessionId, asJson(input.eventIds), input.stateRevision, input.createdAt);
  }

  public saveWorldState(state: GameState, updatedAt: string): void {
    this.db.prepare(`INSERT INTO session_world_states VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET revision = excluded.revision, state_json = excluded.state_json, updated_at = excluded.updated_at`
    ).run(state.sessionId, state.revision, asJson(state), updatedAt);
  }

  public savePlayerPrivateNote(note: PlayerPrivateNote): void {
    this.db.prepare("INSERT INTO player_private_notes VALUES (?, ?, ?, ?, ?, ?)").run(
      note.id, note.sessionId, note.playerId, note.sourceInputId, note.content, note.createdAt,
    );
  }

  public listPlayerPrivateNotes(sessionId: string, playerId: string, limit: number): PlayerPrivateNote[] {
    return this.db.prepare("SELECT * FROM player_private_notes WHERE session_id = ? AND player_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(sessionId, playerId, limit).map((row) => {
        const value = row as Row;
        return { id: String(value.id), sessionId: String(value.session_id), playerId: String(value.player_id), sourceInputId: String(value.source_input_id), content: String(value.content), createdAt: String(value.created_at) };
      });
  }

  public loadWorldState(sessionId: string): GameState | undefined {
    const row = this.db.prepare("SELECT state_json FROM session_world_states WHERE session_id = ?").get(sessionId) as Row | undefined;
    return row ? fromJson<GameState>(row.state_json) : undefined;
  }

  public countObjectiveHistory(sessionId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM objective_history WHERE session_id = ?").get(sessionId) as Row;
    return Number(row.count);
  }

  public appendObjectiveHistory(input: { id: string; sessionId: string; sequence: number; eventType: string; payload: unknown; createdAt: string }): void {
    this.db.prepare("INSERT INTO objective_history VALUES (?, ?, ?, ?, ?, ?)").run(input.id, input.sessionId, input.sequence, input.eventType, asJson(input.payload), input.createdAt);
  }

  public saveIdentity(model: IdentityModel): void {
    this.db.prepare("INSERT INTO character_identity_models VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(model.id, model.sessionId, model.characterId, model.section, model.content, asJson(model.sourceIds), model.version, new Date().toISOString());
  }

  public saveEvidence(record: EvidenceRecord): void {
    this.db.prepare("INSERT INTO character_evidence_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(record.id, record.sessionId, record.characterId, record.kind, record.content, asJson(record.sourceEventIds), record.reliability, record.importance, record.occurredAt);
  }

  public saveEpistemicState(state: EpistemicState): void {
    this.db.prepare("INSERT INTO character_epistemic_states VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(state.id, state.sessionId, state.characterId, state.proposition, state.status, state.confidence, asJson(state.supportingEvidenceIds), asJson(state.opposingEvidenceIds), state.version, new Date().toISOString());
  }

  public saveInterpretiveModel(model: InterpretiveModel): void {
    this.db.prepare("INSERT INTO character_interpretive_models VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(model.id, model.sessionId, model.characterId, model.kind, model.targetId ?? null, model.content, model.activation, asJson(model.supportingEvidenceIds), asJson(model.opposingEvidenceIds), model.version, new Date().toISOString());
  }

  public saveRuntimeState(state: CharacterRuntimeState): void {
    this.db.prepare(`INSERT INTO character_runtime_states VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, character_id) DO UPDATE SET attention_json = excluded.attention_json, emotions_json = excluded.emotions_json,
      active_goals_json = excluded.active_goals_json, current_plan = excluded.current_plan, expression_strategy = excluded.expression_strategy, updated_at = excluded.updated_at`
    ).run(state.sessionId, state.characterId, asJson(state.attention), asJson(state.emotions), asJson(state.activeGoals), state.currentPlan ?? null, state.expressionStrategy ?? null, state.updatedAt);
  }

  public saveAppearanceFactors(factors: CharacterAppearanceFactors): void {
    this.db.prepare(`INSERT INTO character_appearance_factors VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, character_id) DO UPDATE SET active_goals_json = excluded.active_goals_json,
      response_weights_json = excluded.response_weights_json, relationship_weights_json = excluded.relationship_weights_json,
      availability = excluded.availability, updated_at = excluded.updated_at`
    ).run(
      factors.sessionId, factors.characterId, asJson(factors.activeGoals), asJson(factors.responseWeights),
      asJson(factors.relationshipWeights), factors.availability, factors.updatedAt,
    );
  }

  /** Drafts are audit artifacts. Saving one never publishes identity or beliefs. */
  public saveInitializationDraft(record: CifInitializationDraftRecord): void {
    const request = record.brief.request;
    this.db.prepare("INSERT INTO cif_initialization_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      record.id, request.sessionId, request.characterId, request.variantId, request.storyPointId, record.status,
      asJson(record.brief), asJson(record.draft), asJson(record.validationErrors), record.generator,
      record.createdAt, record.reviewedAt ?? null, null,
    );
  }

  public listInitializationDrafts(sessionId: string, characterId: string): CifInitializationDraftRecord[] {
    return this.db.prepare("SELECT * FROM cif_initialization_drafts WHERE session_id = ? AND character_id = ? ORDER BY created_at DESC")
      .all(sessionId, characterId).map((row) => this.initializationDraft(row as Row));
  }

  public getInitializationDraft(id: string): CifInitializationDraftRecord | undefined {
    const row = this.db.prepare("SELECT * FROM cif_initialization_drafts WHERE id = ?").get(id) as Row | undefined;
    return row ? this.initializationDraft(row) : undefined;
  }

  public setInitializationDraftStatus(id: string, status: "approved" | "rejected", reviewedAt: string): void {
    this.db.prepare("UPDATE cif_initialization_drafts SET status = ?, reviewed_at = ? WHERE id = ?").run(status, reviewedAt, id);
  }

  public publishInitializationDraft(id: string, publishedAt: string): void {
    this.db.prepare("UPDATE cif_initialization_drafts SET status = 'published', published_at = ? WHERE id = ? AND status = 'approved'").run(publishedAt, id);
  }

  public hasPublishedInitialization(sessionId: string, characterId: string): boolean {
    const row = this.db.prepare("SELECT 1 AS present FROM cif_initialization_drafts WHERE session_id = ? AND character_id = ? AND status = 'published' LIMIT 1").get(sessionId, characterId) as Row | undefined;
    return row !== undefined;
  }

  public nextObjectiveSequence(sessionId: string): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM objective_history WHERE session_id = ?").get(sessionId) as Row;
    return Number(row.sequence);
  }

  public listIdentity(sessionId: string, characterId: string): IdentityModel[] {
    return this.db.prepare("SELECT * FROM character_identity_models WHERE session_id = ? AND character_id = ? ORDER BY section, version DESC").all(sessionId, characterId).map((row) => this.identity(row as Row));
  }
  public listEvidence(sessionId: string, characterId: string, limit: number): EvidenceRecord[] {
    return this.db.prepare("SELECT * FROM character_evidence_records WHERE session_id = ? AND character_id = ? ORDER BY importance DESC, occurred_at DESC LIMIT ?").all(sessionId, characterId, limit).map((row) => this.evidence(row as Row));
  }
  public listEpistemicStates(sessionId: string, characterId: string, limit: number): EpistemicState[] {
    return this.db.prepare("SELECT * FROM character_epistemic_states WHERE session_id = ? AND character_id = ? ORDER BY confidence DESC LIMIT ?").all(sessionId, characterId, limit).map((row) => this.epistemic(row as Row));
  }
  public listInterpretiveModels(sessionId: string, characterId: string, limit: number): InterpretiveModel[] {
    return this.db.prepare("SELECT * FROM character_interpretive_models WHERE session_id = ? AND character_id = ? ORDER BY activation DESC LIMIT ?").all(sessionId, characterId, limit).map((row) => this.interpretive(row as Row));
  }
  public getRuntimeState(sessionId: string, characterId: string): CharacterRuntimeState | undefined {
    const row = this.db.prepare("SELECT * FROM character_runtime_states WHERE session_id = ? AND character_id = ?").get(sessionId, characterId) as Row | undefined;
    return row ? { sessionId, characterId, attention: fromJson<string[]>(row.attention_json), emotions: fromJson<CharacterRuntimeState["emotions"]>(row.emotions_json), activeGoals: fromJson<string[]>(row.active_goals_json), currentPlan: row.current_plan as string | undefined, expressionStrategy: row.expression_strategy as string | undefined, updatedAt: String(row.updated_at) } : undefined;
  }
  public getAppearanceFactors(sessionId: string, characterId: string): CharacterAppearanceFactors | undefined {
    const row = this.db.prepare("SELECT * FROM character_appearance_factors WHERE session_id = ? AND character_id = ?").get(sessionId, characterId) as Row | undefined;
    if (!row) return undefined;
    return {
      sessionId, characterId, activeGoals: fromJson<string[]>(row.active_goals_json),
      responseWeights: fromJson<Record<string, number>>(row.response_weights_json),
      relationshipWeights: fromJson<Record<string, number>>(row.relationship_weights_json),
      availability: row.availability as CharacterAppearanceFactors["availability"], updatedAt: String(row.updated_at),
    };
  }

  private identity(row: Row): IdentityModel { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), section: row.section as IdentityModel["section"], content: String(row.content), sourceIds: fromJson<string[]>(row.source_ids_json), version: Number(row.version) }; }
  private evidence(row: Row): EvidenceRecord { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), kind: row.kind as EvidenceRecord["kind"], content: String(row.content), sourceEventIds: fromJson<string[]>(row.source_event_ids_json), reliability: Number(row.reliability), importance: Number(row.importance), occurredAt: String(row.occurred_at) }; }
  private epistemic(row: Row): EpistemicState { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), proposition: String(row.proposition), status: row.status as EpistemicState["status"], confidence: Number(row.confidence), supportingEvidenceIds: fromJson<string[]>(row.supporting_evidence_ids_json), opposingEvidenceIds: fromJson<string[]>(row.opposing_evidence_ids_json), version: Number(row.version) }; }
  private interpretive(row: Row): InterpretiveModel { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), kind: row.kind as InterpretiveModel["kind"], targetId: row.target_id ? String(row.target_id) : undefined, content: String(row.content), activation: Number(row.activation), supportingEvidenceIds: fromJson<string[]>(row.supporting_evidence_ids_json), opposingEvidenceIds: fromJson<string[]>(row.opposing_evidence_ids_json), version: Number(row.version) }; }
  private initializationDraft(row: Row): CifInitializationDraftRecord {
    return { id: String(row.id), status: row.status as CifInitializationDraftRecord["status"], brief: fromJson<CifInitializationDraftRecord["brief"]>(row.brief_json), draft: fromJson<CifInitializationDraftRecord["draft"]>(row.draft_json), validationErrors: fromJson<string[]>(row.validation_errors_json), generator: String(row.generator), createdAt: String(row.created_at), reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined };
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!columns.some((entry) => entry.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
