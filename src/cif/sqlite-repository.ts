import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  CharacterRuntimeState,
  CharacterBond,
  CharacterAppearanceFactors,
  CharacterCapability,
  CifL3RevisionDraft,
  CifPatternDraft,
  CharacterLifeContext,
  CharacterProfile,
  EpistemicState,
  EvidenceRecord,
  EpisodeMemory,
  IdentityModel,
  InterpretiveModel,
  MemoryAtom,
  MemoryConsolidationTask,
  ObjectiveRelationship,
  SceneNarrativeProjection,
} from "./types.js";
import type { CifInitializationDraftRecord } from "./initializer.js";
import type { ActionResult, GameEvent, GameState, PlayerPrivateNote } from "../core/contracts.js";
import type { DurableJob, DurableJobClaim } from "../core/durable-jobs.js";
import type { CognitiveAuditVerdict } from "../core/cognitive-evolution.js";
import type { SceneLifecycleEvent, SceneLifecycleSnapshot } from "../core/scene-lifecycle.js";
import type { InteractionPlan } from "../core/interaction-coordinator.js";
import type { InteractionExecution, InteractionExecutionStatus } from "../core/interaction-execution.js";
import type { BranchFact, BranchProgress, PersistedStoryChapterPackage, SessionStoryContext, WorldlineDivergence } from "../core/worldline.js";

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
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY, applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS objective_history (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL,
        event_type TEXT NOT NULL, payload_json TEXT NOT NULL, causation_json TEXT NOT NULL DEFAULT '{}', state_revision INTEGER NOT NULL DEFAULT 0, moment_json TEXT, created_at TEXT NOT NULL,
        UNIQUE(session_id, sequence)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS processed_actions (
        action_id TEXT PRIMARY KEY, request_fingerprint TEXT NOT NULL, session_id TEXT NOT NULL, event_ids_json TEXT NOT NULL,
        state_revision INTEGER NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS session_world_states (
        session_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS session_story_contexts (
        session_id TEXT PRIMARY KEY, player_id TEXT NOT NULL, canon_anchor TEXT NOT NULL,
        checkpoint_node_id TEXT, checkpoint_revision INTEGER NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS branch_facts (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, fact_key TEXT NOT NULL, value_json TEXT NOT NULL,
        source_event_ids_json TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(session_id, fact_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS branch_progress (
        session_id TEXT NOT NULL, player_id TEXT NOT NULL, content_type TEXT NOT NULL, content_id TEXT NOT NULL,
        active_node_id TEXT, status TEXT NOT NULL, completed_node_ids_json TEXT NOT NULL,
        diverted_node_ids_json TEXT NOT NULL, blocked_node_ids_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(session_id, player_id, content_type, content_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS worldline_divergences (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, canon_anchor TEXT NOT NULL, source_event_ids_json TEXT NOT NULL,
        changed_fact_key TEXT NOT NULL, canon_baseline_json TEXT NOT NULL, branch_reality_json TEXT NOT NULL,
        significance TEXT NOT NULL, affected_scope TEXT NOT NULL, known_impact_node_ids_json TEXT NOT NULL,
        pending_impact_chapter_ids_json TEXT NOT NULL, status TEXT NOT NULL, rationale TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(session_id, changed_fact_key, status)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS story_chapter_packages (
        session_id TEXT NOT NULL, package_id TEXT NOT NULL, content_type TEXT NOT NULL, content_id TEXT NOT NULL,
        canon_anchor TEXT NOT NULL, entry_node_id TEXT NOT NULL, source_fragment_ids_json TEXT NOT NULL,
        definition_json TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL,
        activated_at TEXT NOT NULL, invalidated_at TEXT,
        PRIMARY KEY(session_id, package_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS player_private_notes (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, player_id TEXT NOT NULL,
        source_input_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(session_id, source_input_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_identity_models (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        section TEXT NOT NULL, content TEXT NOT NULL, source_ids_json TEXT NOT NULL,
        version INTEGER NOT NULL, origin TEXT NOT NULL DEFAULT 'canon_baseline',
        review_status TEXT NOT NULL DEFAULT 'published', created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_profiles (
        session_id TEXT NOT NULL, character_id TEXT NOT NULL, variant_id TEXT NOT NULL, story_point_id TEXT NOT NULL,
        display_name TEXT NOT NULL, aliases_json TEXT NOT NULL, age_or_life_stage TEXT, social_identity TEXT,
        affiliation TEXT, home_region TEXT, objective_status TEXT, source_ids_json TEXT NOT NULL, version INTEGER NOT NULL,
        PRIMARY KEY(session_id, character_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_capabilities (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL, category TEXT NOT NULL,
        content TEXT NOT NULL, mechanical_tags_json TEXT NOT NULL, source_ids_json TEXT NOT NULL, version INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_life_context (
        session_id TEXT NOT NULL, character_id TEXT NOT NULL, schedule_summary TEXT, responsibilities_json TEXT NOT NULL,
        current_problems_json TEXT NOT NULL, available_resources_json TEXT NOT NULL, missing_resources_json TEXT NOT NULL,
        independent_life_summary TEXT, source_ids_json TEXT NOT NULL, version INTEGER NOT NULL,
        PRIMARY KEY(session_id, character_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS objective_relationships (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL, target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL, shared_history_summary TEXT, current_objective_status TEXT,
        source_ids_json TEXT NOT NULL, version INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_bonds (
        session_id TEXT NOT NULL, player_id TEXT NOT NULL, character_id TEXT NOT NULL,
        bond_level INTEGER NOT NULL CHECK(bond_level BETWEEN 1 AND 15), bond_points INTEGER NOT NULL CHECK(bond_points >= 0),
        total_points INTEGER NOT NULL CHECK(total_points >= 0), updated_at TEXT NOT NULL,
        PRIMARY KEY(session_id, player_id, character_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_bond_gains (
        action_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, player_id TEXT NOT NULL, character_id TEXT NOT NULL,
        points INTEGER NOT NULL CHECK(points > 0), source_event_ids_json TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_evidence_records (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        kind TEXT NOT NULL, content TEXT NOT NULL, source_event_ids_json TEXT NOT NULL,
        source_type TEXT, source_trust REAL, verified_status TEXT, sensory_impression TEXT, recall_cues_json TEXT NOT NULL DEFAULT '[]',
        reliability REAL NOT NULL, importance REAL NOT NULL, occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_memory_atoms (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, owner_id TEXT NOT NULL,
        content TEXT NOT NULL, kind TEXT NOT NULL, source_event_ids_json TEXT NOT NULL,
        participant_ids_json TEXT NOT NULL, location_id TEXT, recall_cues_json TEXT NOT NULL, confidence REAL NOT NULL,
        importance REAL NOT NULL, occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_episode_memories (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, owner_id TEXT NOT NULL,
        source_event_ids_json TEXT NOT NULL, factual_anchor_ids_json TEXT NOT NULL,
        summary TEXT NOT NULL, subjective_interpretation TEXT, emotions_json TEXT NOT NULL,
        participant_ids_json TEXT NOT NULL, location_id TEXT, salience REAL NOT NULL,
        status TEXT NOT NULL, recall_cues_json TEXT NOT NULL DEFAULT '[]', occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS memory_scene_windows (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        trigger TEXT NOT NULL, evidence_ids_json TEXT NOT NULL, participant_ids_json TEXT NOT NULL,
        location_id TEXT, opened_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS memory_consolidation_tasks (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        trigger TEXT NOT NULL, source_evidence_ids_json TEXT NOT NULL, participant_ids_json TEXT NOT NULL,
        location_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT, leased_at TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cif_pattern_drafts (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL, trigger_episode_id TEXT NOT NULL,
        status TEXT NOT NULL, proposal_json TEXT NOT NULL, validation_errors_json TEXT NOT NULL, audit_json TEXT,
        generator TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_at TEXT, published_at TEXT,
        UNIQUE(session_id, character_id, trigger_episode_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS cif_l3_revision_drafts (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, character_id TEXT NOT NULL, trigger_episode_id TEXT NOT NULL,
        status TEXT NOT NULL, proposal_json TEXT NOT NULL, validation_errors_json TEXT NOT NULL, audit_json TEXT,
        generator TEXT NOT NULL, created_at TEXT NOT NULL, reviewed_at TEXT, published_at TEXT,
        UNIQUE(session_id, character_id, trigger_episode_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS scene_lifecycle_snapshots (
        session_id TEXT NOT NULL, player_id TEXT NOT NULL, scene_id TEXT NOT NULL, phase TEXT NOT NULL,
        opened_at TEXT NOT NULL, interaction_count INTEGER NOT NULL, last_interaction_id TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY(session_id, player_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS scene_lifecycle_events (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, player_id TEXT NOT NULL, scene_id TEXT NOT NULL,
        type TEXT NOT NULL, source_event_id TEXT NOT NULL, source_action_id TEXT, payload_json TEXT NOT NULL, occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS interaction_plans (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, player_id TEXT NOT NULL, scene_id TEXT NOT NULL,
        source_event_id TEXT NOT NULL, source_action_id TEXT NOT NULL, status TEXT NOT NULL,
        response_event_id TEXT, lead_character_id TEXT, participants_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(session_id, source_action_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS interaction_executions (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, player_action_id TEXT NOT NULL, player_id TEXT NOT NULL, scene_id TEXT NOT NULL,
        action_json TEXT NOT NULL, lead_character_id TEXT, status TEXT NOT NULL, attempt INTEGER NOT NULL, max_attempts INTEGER NOT NULL, reason TEXT, response_event_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(session_id, player_action_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS durable_jobs (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL,
        payload_json TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL, available_at TEXT NOT NULL, leased_at TEXT, lease_owner TEXT,
        completed_at TEXT, error TEXT, created_at TEXT NOT NULL,
        UNIQUE(session_id, kind, dedupe_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS scene_narrative_projections (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, source_event_ids_json TEXT NOT NULL,
        participant_ids_json TEXT NOT NULL, location_id TEXT, public_summary TEXT NOT NULL,
        open_threads_json TEXT NOT NULL, story_pressures_json TEXT NOT NULL, created_at TEXT NOT NULL
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
        scope TEXT, stability TEXT, exceptions_json TEXT NOT NULL DEFAULT '[]', change_conditions_json TEXT NOT NULL DEFAULT '[]',
        predicted_behavior TEXT, perceived_values_json TEXT NOT NULL DEFAULT '[]', perceived_fears_json TEXT NOT NULL DEFAULT '[]',
        believed_view_of_self TEXT, expected_actions_json TEXT NOT NULL DEFAULT '[]', feared_actions_json TEXT NOT NULL DEFAULT '[]',
        revision_conditions_json TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL, updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS character_runtime_states (
        session_id TEXT NOT NULL, character_id TEXT NOT NULL,
        attention_json TEXT NOT NULL, emotions_json TEXT NOT NULL, active_goals_json TEXT NOT NULL,
        location_id TEXT, availability TEXT, current_intention TEXT, current_plan TEXT, expression_strategy TEXT, last_proactive_interaction_tick INTEGER, known_player_location_id TEXT, approach_player TEXT, updated_at TEXT NOT NULL,
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
      CREATE INDEX IF NOT EXISTS capabilities_by_character ON character_capabilities(session_id, character_id, category);
      CREATE INDEX IF NOT EXISTS objective_relationships_by_character ON objective_relationships(session_id, character_id, target_id);
      CREATE INDEX IF NOT EXISTS character_bonds_by_player ON character_bonds(session_id, player_id, bond_level DESC);
      CREATE INDEX IF NOT EXISTS memory_atoms_by_owner ON character_memory_atoms(session_id, owner_id, importance DESC, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS episodes_by_owner ON character_episode_memories(session_id, owner_id, salience DESC, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS pending_memory_tasks ON memory_consolidation_tasks(session_id, status, created_at);
      CREATE INDEX IF NOT EXISTS ready_durable_jobs ON durable_jobs(session_id, status, available_at, created_at);
      CREATE INDEX IF NOT EXISTS branch_facts_by_session ON branch_facts(session_id, fact_key);
      CREATE INDEX IF NOT EXISTS divergences_by_session ON worldline_divergences(session_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS active_chapter_packages ON story_chapter_packages(session_id, status, content_id);
      CREATE INDEX IF NOT EXISTS narrative_projection_by_session ON scene_narrative_projections(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS epistemic_by_character ON character_epistemic_states(session_id, character_id, confidence DESC);
      CREATE INDEX IF NOT EXISTS interpretive_by_character ON character_interpretive_models(session_id, character_id, activation DESC);
      CREATE INDEX IF NOT EXISTS cif_drafts_by_character ON cif_initialization_drafts(session_id, character_id, status, created_at DESC);
    `);
    this.migrateSchema();
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

  public recordProcessedAction(input: { actionId: string; requestFingerprint: string; sessionId: string; eventIds: string[]; stateRevision: number; createdAt: string }): void {
    this.db.prepare("INSERT INTO processed_actions (action_id, request_fingerprint, session_id, event_ids_json, state_revision, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.actionId, input.requestFingerprint, input.sessionId, asJson(input.eventIds), input.stateRevision, input.createdAt);
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

  public saveStoryContext(context: SessionStoryContext): void {
    this.db.prepare(`INSERT INTO session_story_contexts VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET player_id = excluded.player_id, canon_anchor = excluded.canon_anchor,
      checkpoint_node_id = excluded.checkpoint_node_id, checkpoint_revision = excluded.checkpoint_revision, updated_at = excluded.updated_at`)
      .run(context.sessionId, context.playerId, context.canonAnchor, context.checkpointNodeId ?? null, context.checkpointRevision, context.updatedAt);
  }

  public getStoryContext(sessionId: string): SessionStoryContext | undefined {
    const row = this.db.prepare("SELECT * FROM session_story_contexts WHERE session_id = ?").get(sessionId) as Row | undefined;
    return row ? { sessionId: String(row.session_id), playerId: String(row.player_id), canonAnchor: String(row.canon_anchor),
      ...(row.checkpoint_node_id ? { checkpointNodeId: String(row.checkpoint_node_id) } : {}), checkpointRevision: Number(row.checkpoint_revision), updatedAt: String(row.updated_at) } : undefined;
  }

  public saveBranchFact(fact: BranchFact): void {
    this.db.prepare(`INSERT INTO branch_facts VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, fact_key) DO UPDATE SET id = excluded.id, value_json = excluded.value_json,
      source_event_ids_json = excluded.source_event_ids_json, updated_at = excluded.updated_at`)
      .run(fact.id, fact.sessionId, fact.factKey, asJson(fact.value), asJson(fact.sourceEventIds), fact.updatedAt);
  }

  public getBranchFact(sessionId: string, factKey: string): BranchFact | undefined {
    const row = this.db.prepare("SELECT * FROM branch_facts WHERE session_id = ? AND fact_key = ?").get(sessionId, factKey) as Row | undefined;
    return row ? this.branchFact(row) : undefined;
  }

  public listBranchFacts(sessionId: string): BranchFact[] {
    return (this.db.prepare("SELECT * FROM branch_facts WHERE session_id = ? ORDER BY fact_key").all(sessionId) as Row[]).map((row) => this.branchFact(row));
  }

  public saveBranchProgress(progress: BranchProgress): void {
    this.db.prepare(`INSERT INTO branch_progress VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, player_id, content_type, content_id) DO UPDATE SET active_node_id = excluded.active_node_id,
      status = excluded.status, completed_node_ids_json = excluded.completed_node_ids_json,
      diverted_node_ids_json = excluded.diverted_node_ids_json, blocked_node_ids_json = excluded.blocked_node_ids_json, updated_at = excluded.updated_at`)
      .run(progress.sessionId, progress.playerId, progress.contentType, progress.contentId, progress.activeNodeId ?? null, progress.status,
        asJson(progress.completedNodeIds), asJson(progress.divertedNodeIds), asJson(progress.blockedNodeIds), progress.updatedAt);
  }

  public getBranchProgress(sessionId: string, playerId: string, contentType: BranchProgress["contentType"], contentId: string): BranchProgress | undefined {
    const row = this.db.prepare("SELECT * FROM branch_progress WHERE session_id = ? AND player_id = ? AND content_type = ? AND content_id = ?")
      .get(sessionId, playerId, contentType, contentId) as Row | undefined;
    return row ? this.branchProgress(row) : undefined;
  }

  public saveWorldlineDivergence(divergence: WorldlineDivergence): void {
    this.db.prepare(`INSERT INTO worldline_divergences VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, changed_fact_key, status) DO UPDATE SET canon_anchor = excluded.canon_anchor,
      source_event_ids_json = excluded.source_event_ids_json, branch_reality_json = excluded.branch_reality_json,
      significance = excluded.significance, affected_scope = excluded.affected_scope,
      known_impact_node_ids_json = excluded.known_impact_node_ids_json,
      pending_impact_chapter_ids_json = excluded.pending_impact_chapter_ids_json,
      rationale = excluded.rationale, updated_at = excluded.updated_at`)
      .run(divergence.id, divergence.sessionId, divergence.canonAnchor, asJson(divergence.sourceEventIds), divergence.changedFactKey,
        asJson(divergence.canonBaseline), asJson(divergence.branchReality), divergence.significance, divergence.affectedScope,
        asJson(divergence.knownImpactNodeIds), asJson(divergence.pendingImpactChapterIds), divergence.status, divergence.rationale,
        divergence.createdAt, divergence.updatedAt);
  }

  public listWorldlineDivergences(sessionId: string): WorldlineDivergence[] {
    return (this.db.prepare("SELECT * FROM worldline_divergences WHERE session_id = ? ORDER BY updated_at DESC").all(sessionId) as Row[])
      .map((row) => this.worldlineDivergence(row));
  }

  public saveStoryChapterPackage(value: PersistedStoryChapterPackage): void {
    this.db.prepare(`INSERT INTO story_chapter_packages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, package_id) DO UPDATE SET content_type = excluded.content_type, content_id = excluded.content_id,
      canon_anchor = excluded.canon_anchor, entry_node_id = excluded.entry_node_id, source_fragment_ids_json = excluded.source_fragment_ids_json,
      definition_json = excluded.definition_json, status = excluded.status, version = excluded.version,
      activated_at = excluded.activated_at, invalidated_at = excluded.invalidated_at`)
      .run(value.sessionId, value.packageId, value.contentType, value.contentId, value.canonAnchor, value.entryNodeId,
        asJson(value.sourceFragmentIds), asJson({ nodeRules: value.nodeRules, assessmentPolicies: value.assessmentPolicies ?? [] }), value.status, value.version, value.activatedAt, value.invalidatedAt ?? null);
  }

  public deactivateChapterPackages(sessionId: string, contentType: BranchProgress["contentType"], contentId: string, updatedAt: string): void {
    this.db.prepare("UPDATE story_chapter_packages SET status = 'inactive', invalidated_at = ? WHERE session_id = ? AND content_type = ? AND content_id = ? AND status = 'active'")
      .run(updatedAt, sessionId, contentType, contentId);
  }

  public listActiveStoryChapterPackages(sessionId: string): PersistedStoryChapterPackage[] {
    return (this.db.prepare("SELECT * FROM story_chapter_packages WHERE session_id = ? AND status = 'active' ORDER BY activated_at").all(sessionId) as Row[])
      .map((row) => this.storyChapterPackage(row));
  }

  public countObjectiveHistory(sessionId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM objective_history WHERE session_id = ?").get(sessionId) as Row;
    return Number(row.count);
  }

  public appendObjectiveHistory(input: { id: string; sessionId: string; sequence: number; eventType: string; payload: unknown; causation?: GameEvent["causation"]; stateRevision?: number; moment?: GameEvent["moment"]; createdAt: string }): void {
    this.db.prepare("INSERT INTO objective_history (id, session_id, sequence, event_type, payload_json, causation_json, state_revision, moment_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(input.id, input.sessionId, input.sequence, input.eventType, asJson(input.payload), asJson(input.causation ?? {}), input.stateRevision ?? 0,
        input.moment ? asJson(input.moment) : null, input.createdAt);
  }

  /** Rebuilds the exact public ActionResult persisted by a successful turn. */
  public getProcessedActionResult(actionId: string, requestFingerprint: string): ActionResult | undefined {
    const processed = this.db.prepare("SELECT * FROM processed_actions WHERE action_id = ?").get(actionId) as Row | undefined;
    if (!processed) return undefined;
    if (processed.request_fingerprint !== requestFingerprint) throw new Error("action_id_conflict");
    const eventIds = fromJson<string[]>(processed.event_ids_json);
    if (!eventIds.length) return { actionId, events: [], stateRevision: Number(processed.state_revision) };
    const placeholders = eventIds.map(() => "?").join(", ");
    const byId = new Map((this.db.prepare(`SELECT * FROM objective_history WHERE id IN (${placeholders})`).all(...eventIds) as Row[])
      .map((row) => [String(row.id), this.historyEvent(row)]));
    const events = eventIds.map((id) => byId.get(id));
    if (events.some((event) => !event)) throw new Error("processed_action_history_missing");
    return { actionId, events: events as GameEvent[], stateRevision: Number(processed.state_revision) };
  }

  public listObjectiveHistoryByIds(sessionId: string, eventIds: readonly string[]): GameEvent[] {
    if (!eventIds.length) return [];
    const placeholders = eventIds.map(() => "?").join(", ");
    const byId = new Map((this.db.prepare(`SELECT * FROM objective_history WHERE session_id = ? AND id IN (${placeholders})`).all(sessionId, ...eventIds) as Row[])
      .map((row) => [String(row.id), this.historyEvent(row)]));
    return eventIds.map((id) => byId.get(id)).filter((event): event is GameEvent => event !== undefined);
  }

  /**
   * Adds work inside the caller's transaction. Duplicate delivery keys are a
   * successful no-op, so a retried turn cannot create duplicate background work.
   */
  public enqueueDurableJob(job: DurableJob): void {
    this.db.prepare(`INSERT INTO durable_jobs
      (id, session_id, kind, dedupe_key, payload_json, status, attempts, max_attempts, available_at, leased_at, lease_owner, completed_at, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, kind, dedupe_key) DO NOTHING`).run(
      job.id, job.sessionId, job.kind, job.dedupeKey, asJson(job.payload), job.status, job.attempts,
      job.maxAttempts, job.availableAt, job.leasedAt ?? null, job.leaseOwner ?? null, job.completedAt ?? null,
      job.error ?? null, job.createdAt,
    );
  }

  /** Atomically leases one ready item, including work abandoned by a dead worker. */
  public claimDurableJob(claim: DurableJobClaim): DurableJob | undefined {
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM durable_jobs
        WHERE session_id = ? AND (
          (status = 'pending' AND julianday(available_at) <= julianday(?)) OR
          (status = 'processing' AND leased_at IS NOT NULL AND julianday(leased_at) <= julianday(?))
        ) ${claim.kind ? "AND kind = ?" : ""} ORDER BY available_at, created_at LIMIT 1`)
        .get(...[claim.sessionId, claim.now, claim.leaseExpiresBefore, ...(claim.kind ? [claim.kind] : [])]) as Row | undefined;
      if (!row) return undefined;
      this.db.prepare(`UPDATE durable_jobs SET status = 'processing', attempts = attempts + 1,
        leased_at = ?, lease_owner = ?, error = NULL WHERE id = ?`).run(claim.now, claim.workerId, String(row.id));
      return this.durableJob({ ...row, status: "processing", attempts: Number(row.attempts) + 1, leased_at: claim.now, lease_owner: claim.workerId, error: null });
    });
  }

  public completeDurableJob(id: string, workerId: string, completedAt: string): void {
    this.db.prepare(`UPDATE durable_jobs SET status = 'completed', completed_at = ?, leased_at = NULL,
      lease_owner = NULL, error = NULL WHERE id = ? AND status = 'processing' AND lease_owner = ?`).run(completedAt, id, workerId);
  }

  public retryDurableJob(id: string, workerId: string, error: string, availableAt: string): void {
    this.db.prepare(`UPDATE durable_jobs SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
      error = ?, available_at = ?, leased_at = NULL, lease_owner = NULL
      WHERE id = ? AND status = 'processing' AND lease_owner = ?`).run(error, availableAt, id, workerId);
  }

  /** Releases a blocked task without consuming its retry budget. */
  public deferDurableJob(id: string, workerId: string, availableAt: string): void {
    this.db.prepare(`UPDATE durable_jobs SET status = 'pending', attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
      available_at = ?, leased_at = NULL, lease_owner = NULL WHERE id = ? AND status = 'processing' AND lease_owner = ?`)
      .run(availableAt, id, workerId);
  }

  public saveIdentity(model: IdentityModel): void {
    this.db.prepare(`INSERT INTO character_identity_models (id, session_id, character_id, section, content, source_ids_json, version, origin, review_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(model.id, model.sessionId, model.characterId, model.section, model.content, asJson(model.sourceIds), model.version, model.origin ?? "canon_baseline", model.reviewStatus ?? "published", new Date().toISOString());
  }

  public saveProfile(profile: CharacterProfile): void {
    this.db.prepare(`INSERT INTO character_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, character_id) DO UPDATE SET variant_id = excluded.variant_id, story_point_id = excluded.story_point_id,
      display_name = excluded.display_name, aliases_json = excluded.aliases_json, age_or_life_stage = excluded.age_or_life_stage,
      social_identity = excluded.social_identity, affiliation = excluded.affiliation, home_region = excluded.home_region,
      objective_status = excluded.objective_status, source_ids_json = excluded.source_ids_json, version = excluded.version`
    ).run(profile.sessionId, profile.characterId, profile.variantId, profile.storyPointId, profile.displayName, asJson(profile.aliases),
      profile.ageOrLifeStage ?? null, profile.socialIdentity ?? null, profile.affiliation ?? null, profile.homeRegion ?? null,
      profile.objectiveStatus ?? null, asJson(profile.sourceIds), profile.version);
  }

  public saveCapability(capability: CharacterCapability): void {
    this.db.prepare("INSERT INTO character_capabilities VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      capability.id, capability.sessionId, capability.characterId, capability.category, capability.content,
      asJson(capability.mechanicalTags), asJson(capability.sourceIds), capability.version,
    );
  }

  public saveLifeContext(context: CharacterLifeContext): void {
    this.db.prepare(`INSERT INTO character_life_context VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, character_id) DO UPDATE SET schedule_summary = excluded.schedule_summary,
      responsibilities_json = excluded.responsibilities_json, current_problems_json = excluded.current_problems_json,
      available_resources_json = excluded.available_resources_json, missing_resources_json = excluded.missing_resources_json,
      independent_life_summary = excluded.independent_life_summary, source_ids_json = excluded.source_ids_json, version = excluded.version`
    ).run(context.sessionId, context.characterId, context.scheduleSummary ?? null, asJson(context.responsibilities ?? []),
      asJson(context.currentProblems ?? []), asJson(context.availableResources ?? []), asJson(context.missingResources ?? []),
      context.independentLifeSummary ?? null, asJson(context.sourceIds), context.version);
  }

  public saveObjectiveRelationship(relationship: ObjectiveRelationship): void {
    this.db.prepare("INSERT INTO objective_relationships VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      relationship.id, relationship.sessionId, relationship.characterId, relationship.targetId, relationship.relationType,
      relationship.sharedHistorySummary ?? null, relationship.currentObjectiveStatus ?? null, asJson(relationship.sourceIds), relationship.version,
    );
  }

  /** Grants a small, source-linked amount once per settled player action. Call inside the turn transaction. */
  public grantBond(input: { actionId: string; sessionId: string; playerId: string; characterId: string; points: number; sourceEventIds: string[]; createdAt: string }): CharacterBond {
    const existingGain = this.db.prepare("SELECT 1 AS present FROM character_bond_gains WHERE action_id = ?").get(input.actionId) as Row | undefined;
    const current = this.getBond(input.sessionId, input.playerId, input.characterId) ?? {
      sessionId: input.sessionId, playerId: input.playerId, characterId: input.characterId, level: 1, points: 0, totalPoints: 0, updatedAt: input.createdAt,
    };
    if (existingGain) return current;
    let level = current.level; let points = current.points;
    if (level < 15) {
      points += input.points;
      while (points >= 10 && level < 15) { points -= 10; level += 1; }
      if (level === 15) points = 0;
    }
    const next: CharacterBond = { ...current, level, points, totalPoints: current.totalPoints + input.points, updatedAt: input.createdAt };
    this.db.prepare(`INSERT INTO character_bonds VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, player_id, character_id) DO UPDATE SET bond_level=excluded.bond_level, bond_points=excluded.bond_points,
      total_points=excluded.total_points, updated_at=excluded.updated_at`)
      .run(next.sessionId, next.playerId, next.characterId, next.level, next.points, next.totalPoints, next.updatedAt);
    this.db.prepare("INSERT INTO character_bond_gains VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      input.actionId, input.sessionId, input.playerId, input.characterId, input.points, asJson(input.sourceEventIds), input.createdAt,
    );
    return next;
  }

  public saveEvidence(record: EvidenceRecord): void {
    this.db.prepare(`INSERT INTO character_evidence_records (id, session_id, character_id, kind, content, source_event_ids_json, source_type, source_trust, verified_status, sensory_impression, recall_cues_json, reliability, importance, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(record.id, record.sessionId, record.characterId, record.kind, record.content, asJson(record.sourceEventIds), record.sourceType ?? null, record.sourceTrust ?? null, record.verifiedStatus ?? null, record.sensoryImpression ?? null, asJson(record.recallCues ?? []), record.reliability, record.importance, record.occurredAt);
  }

  public saveMemoryAtom(atom: MemoryAtom): void {
    this.db.prepare("INSERT INTO character_memory_atoms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      atom.id, atom.sessionId, atom.ownerId, atom.content, atom.kind, asJson(atom.sourceEventIds),
      asJson(atom.participantIds), atom.locationId ?? null, asJson(atom.recallCues ?? []), atom.confidence, atom.importance, atom.occurredAt,
    );
  }

  public saveEpisodeMemory(memory: EpisodeMemory): void {
    this.db.prepare(`INSERT INTO character_episode_memories (id, session_id, owner_id, source_event_ids_json, factual_anchor_ids_json, summary, subjective_interpretation, emotions_json, participant_ids_json, location_id, salience, status, recall_cues_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      memory.id, memory.sessionId, memory.ownerId, asJson(memory.sourceEventIds), asJson(memory.factualAnchorIds),
      memory.summary, memory.subjectiveInterpretation ?? null, asJson(memory.emotions), asJson(memory.participantIds),
      memory.locationId ?? null, memory.salience, memory.status, asJson(memory.recallCues ?? []), memory.occurredAt,
    );
  }

  public savePatternDraft(draft: CifPatternDraft): void {
    this.db.prepare("INSERT INTO cif_pattern_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      draft.id, draft.sessionId, draft.characterId, draft.triggerEpisodeId, draft.status,
      asJson(draft.proposal), asJson(draft.validationErrors), draft.audit ? asJson(draft.audit) : null, draft.generator, draft.createdAt, draft.reviewedAt ?? null, draft.publishedAt ?? null,
    );
  }
  public getPatternDraft(id: string): CifPatternDraft | undefined {
    const row = this.db.prepare("SELECT * FROM cif_pattern_drafts WHERE id = ?").get(id) as Row | undefined;
    return row && this.patternDraft(row);
  }
  public setPatternDraftStatus(id: string, status: "approved" | "rejected", reviewedAt: string): void {
    this.db.prepare("UPDATE cif_pattern_drafts SET status = ?, reviewed_at = ? WHERE id = ? AND status = 'pending_review'").run(status, reviewedAt, id);
  }
  public resolvePatternDraftAudit(id: string, status: "approved" | "deferred" | "rejected", audit: CifPatternDraft["audit"], reviewedAt: string): void {
    this.db.prepare("UPDATE cif_pattern_drafts SET status = ?, audit_json = ?, reviewed_at = ? WHERE id = ? AND status = 'pending_audit'").run(status, audit ? asJson(audit) : null, reviewedAt, id);
  }
  public publishPatternDraft(id: string, publishedAt: string): void {
    this.db.prepare("UPDATE cif_pattern_drafts SET status = 'published', published_at = ? WHERE id = ? AND status = 'approved'").run(publishedAt, id);
  }

  public openMemorySceneWindow(input: Omit<MemoryConsolidationTask, "id" | "sourceEvidenceIds" | "status" | "attempts" | "createdAt" | "availableAt" | "leasedAt" | "completedAt" | "error"> & { evidenceIds: string[]; openedAt: string }): void {
    this.db.prepare("INSERT INTO memory_scene_windows VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      `${input.sessionId}:${input.characterId}:${input.trigger}`, input.sessionId, input.characterId, input.trigger,
      asJson(input.evidenceIds), asJson(input.participantIds), input.locationId ?? null, input.openedAt,
    );
  }

  public appendEvidenceToOpenMemoryWindows(sessionId: string, characterId: string, evidenceId: string): void {
    const rows = this.db.prepare("SELECT * FROM memory_scene_windows WHERE session_id = ? AND character_id = ?").all(sessionId, characterId) as Row[];
    for (const row of rows) {
      const ids = fromJson<string[]>(row.evidence_ids_json);
      if (!ids.includes(evidenceId)) ids.push(evidenceId);
      this.db.prepare("UPDATE memory_scene_windows SET evidence_ids_json = ? WHERE id = ?").run(asJson(ids), String(row.id));
    }
  }

  public closeMemorySceneWindowsAt(sessionId: string, locationId: string, completedAt: string): void {
    const rows = this.db.prepare("SELECT * FROM memory_scene_windows WHERE session_id = ? AND location_id = ?").all(sessionId, locationId) as Row[];
    for (const row of rows) {
      const task = {
        characterId: String(row.character_id), trigger: row.trigger as MemoryConsolidationTask["trigger"],
        sourceEvidenceIds: fromJson<string[]>(row.evidence_ids_json), participantIds: fromJson<string[]>(row.participant_ids_json), locationId,
      };
      this.enqueueDurableJob({
        id: crypto.randomUUID(), sessionId, kind: "memory.l1", dedupeKey: `${String(row.id)}:${completedAt}`,
        payload: task, status: "pending", attempts: 0, maxAttempts: 5, availableAt: completedAt, createdAt: completedAt,
      });
      this.db.prepare("DELETE FROM memory_scene_windows WHERE id = ?").run(String(row.id));
    }
  }

  public saveMemoryConsolidationTask(task: MemoryConsolidationTask): void {
    this.db.prepare("INSERT INTO memory_consolidation_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      task.id, task.sessionId, task.characterId, task.trigger, asJson(task.sourceEvidenceIds), asJson(task.participantIds), task.locationId ?? null,
      task.status, task.createdAt, task.completedAt ?? null, task.error ?? null, task.attempts, task.availableAt ?? task.createdAt, task.leasedAt ?? null,
    );
  }

  public saveSceneNarrativeProjection(projection: SceneNarrativeProjection): void {
    this.db.prepare("INSERT INTO scene_narrative_projections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      projection.id, projection.sessionId, asJson(projection.sourceEventIds), asJson(projection.participantIds), projection.locationId ?? null,
      projection.publicSummary, asJson(projection.openThreads), asJson(projection.storyPressures), projection.createdAt,
    );
  }

  /** Atomically claims one ready or abandoned task so a worker can safely process it. */
  public claimMemoryConsolidationTask(sessionId: string, now: string, abandonedBefore: string): MemoryConsolidationTask | undefined {
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM memory_consolidation_tasks
        WHERE session_id = ? AND ((status IN ('pending', 'failed') AND julianday(COALESCE(available_at, created_at)) <= julianday(?))
          OR (status = 'processing' AND leased_at IS NOT NULL AND julianday(leased_at) <= julianday(?)))
        ORDER BY created_at LIMIT 1`).get(sessionId, now, abandonedBefore) as Row | undefined;
      if (!row) return undefined;
      this.db.prepare(`UPDATE memory_consolidation_tasks
        SET status = 'processing', attempts = attempts + 1, leased_at = ?, available_at = NULL, error = NULL
        WHERE id = ?`).run(now, String(row.id));
      return this.memoryTask({ ...row, status: "processing", attempts: Number(row.attempts) + 1, leased_at: now, available_at: null, error: null });
    });
  }

  public completeMemoryConsolidationTask(id: string, status: "completed" | "ignored", completedAt: string): void {
    this.db.prepare("UPDATE memory_consolidation_tasks SET status = ?, completed_at = ?, leased_at = NULL, error = NULL WHERE id = ?").run(status, completedAt, id);
  }

  public retryMemoryConsolidationTask(id: string, error: string, availableAt: string): void {
    this.db.prepare("UPDATE memory_consolidation_tasks SET status = 'failed', error = ?, available_at = ?, leased_at = NULL WHERE id = ?").run(error, availableAt, id);
  }

  public saveEpistemicState(state: EpistemicState): void {
    this.db.prepare("INSERT INTO character_epistemic_states VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(state.id, state.sessionId, state.characterId, state.proposition, state.status, state.confidence, asJson(state.supportingEvidenceIds), asJson(state.opposingEvidenceIds), state.version, new Date().toISOString());
  }

  public saveInterpretiveModel(model: InterpretiveModel): void {
    this.db.prepare(`INSERT INTO character_interpretive_models (id, session_id, character_id, kind, target_id, content, activation, supporting_evidence_ids_json, opposing_evidence_ids_json, scope, stability, exceptions_json, change_conditions_json, predicted_behavior, perceived_values_json, perceived_fears_json, believed_view_of_self, expected_actions_json, feared_actions_json, revision_conditions_json, version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(model.id, model.sessionId, model.characterId, model.kind, model.targetId ?? null, model.content, model.activation, asJson(model.supportingEvidenceIds), asJson(model.opposingEvidenceIds), model.scope ?? null, model.stability ?? null, asJson(model.exceptions ?? []), asJson(model.changeConditions ?? []), model.predictedBehavior ?? null, asJson(model.perceivedValues ?? []), asJson(model.perceivedFears ?? []), model.believedViewOfSelf ?? null, asJson(model.expectedActions ?? []), asJson(model.fearedActions ?? []), asJson(model.revisionConditions ?? []), model.version, new Date().toISOString());
  }

  public saveRuntimeState(state: CharacterRuntimeState): void {
    this.db.prepare(`INSERT INTO character_runtime_states (session_id, character_id, attention_json, emotions_json, active_goals_json, location_id, availability, current_intention, current_plan, expression_strategy, last_proactive_interaction_tick, known_player_location_id, approach_player, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, character_id) DO UPDATE SET attention_json = excluded.attention_json, emotions_json = excluded.emotions_json,
      active_goals_json = excluded.active_goals_json, location_id = excluded.location_id, availability = excluded.availability,
      current_intention = excluded.current_intention, current_plan = excluded.current_plan, expression_strategy = excluded.expression_strategy,
      last_proactive_interaction_tick = excluded.last_proactive_interaction_tick, known_player_location_id = excluded.known_player_location_id,
      approach_player = excluded.approach_player, updated_at = excluded.updated_at`
    ).run(state.sessionId, state.characterId, asJson(state.attention), asJson(state.emotions), asJson(state.activeGoals), state.locationId ?? null, state.availability ?? null, state.currentIntention ?? null, state.currentPlan ?? null, state.expressionStrategy ?? null, state.lastProactiveInteractionTick ?? null, state.knownPlayerLocationId ?? null, state.approachPlayer ?? null, state.updatedAt);
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

  public listIdentity(sessionId: string, characterId: string, sections?: readonly IdentityModel["section"][]): IdentityModel[] {
    if (sections?.length) {
      const placeholders = sections.map(() => "?").join(", ");
      return this.db.prepare(`SELECT * FROM character_identity_models AS current WHERE session_id = ? AND character_id = ? AND section IN (${placeholders})
        AND review_status = 'published' AND version = (SELECT MAX(version) FROM character_identity_models AS newer WHERE newer.session_id = current.session_id AND newer.character_id = current.character_id AND newer.section = current.section AND newer.review_status = 'published') ORDER BY section`)
        .all(sessionId, characterId, ...sections).map((row) => this.identity(row as Row));
    }
    return this.db.prepare(`SELECT * FROM character_identity_models AS current WHERE session_id = ? AND character_id = ? AND review_status = 'published'
      AND version = (SELECT MAX(version) FROM character_identity_models AS newer WHERE newer.session_id = current.session_id AND newer.character_id = current.character_id AND newer.section = current.section AND newer.review_status = 'published') ORDER BY section`).all(sessionId, characterId).map((row) => this.identity(row as Row));
  }
  public saveL3RevisionDraft(draft: CifL3RevisionDraft): void {
    this.db.prepare(`INSERT INTO cif_l3_revision_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(draft.id, draft.sessionId, draft.characterId, draft.triggerEpisodeId, draft.status, asJson(draft.proposal), asJson(draft.validationErrors), draft.audit ? asJson(draft.audit) : null, draft.generator, draft.createdAt, draft.reviewedAt ?? null, draft.publishedAt ?? null);
  }
  public getL3RevisionDraft(id: string): CifL3RevisionDraft | undefined {
    const row = this.db.prepare("SELECT * FROM cif_l3_revision_drafts WHERE id = ?").get(id) as Row | undefined;
    return row ? this.l3RevisionDraft(row) : undefined;
  }
  public resolveL3RevisionAudit(id: string, status: "approved" | "deferred" | "rejected", audit: CognitiveAuditVerdict, reviewedAt: string): void {
    this.db.prepare("UPDATE cif_l3_revision_drafts SET status = ?, audit_json = ?, reviewed_at = ? WHERE id = ? AND status = 'pending_audit'").run(status, asJson(audit), reviewedAt, id);
  }
  public publishL3RevisionDraft(id: string, publishedAt: string): void {
    this.db.prepare("UPDATE cif_l3_revision_drafts SET status = 'published', published_at = ? WHERE id = ? AND status = 'approved'").run(publishedAt, id);
  }
  public getSceneLifecycle(sessionId: string, playerId: string): SceneLifecycleSnapshot | undefined {
    const row = this.db.prepare("SELECT * FROM scene_lifecycle_snapshots WHERE session_id = ? AND player_id = ?").get(sessionId, playerId) as Row | undefined;
    return row ? { sessionId, playerId, sceneId: String(row.scene_id), phase: row.phase as SceneLifecycleSnapshot["phase"], openedAt: String(row.opened_at), interactionCount: Number(row.interaction_count), ...(row.last_interaction_id ? { lastInteractionId: String(row.last_interaction_id) } : {}), updatedAt: String(row.updated_at) } : undefined;
  }
  public saveSceneLifecycle(snapshot: SceneLifecycleSnapshot): void {
    this.db.prepare(`INSERT INTO scene_lifecycle_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, player_id) DO UPDATE SET scene_id=excluded.scene_id, phase=excluded.phase, opened_at=excluded.opened_at, interaction_count=excluded.interaction_count, last_interaction_id=excluded.last_interaction_id, updated_at=excluded.updated_at`)
      .run(snapshot.sessionId, snapshot.playerId, snapshot.sceneId, snapshot.phase, snapshot.openedAt, snapshot.interactionCount, snapshot.lastInteractionId ?? null, snapshot.updatedAt);
  }
  public recordSceneLifecycleEvent(event: SceneLifecycleEvent): void {
    this.db.prepare("INSERT INTO scene_lifecycle_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .run(event.id, event.sessionId, event.playerId, event.sceneId, event.type, event.sourceEventId, event.sourceActionId ?? null, asJson(event.payload), event.occurredAt);
  }
  public listSceneLifecycleEvents(sessionId: string, playerId: string): SceneLifecycleEvent[] {
    return (this.db.prepare("SELECT * FROM scene_lifecycle_events WHERE session_id = ? AND player_id = ? ORDER BY occurred_at, id").all(sessionId, playerId) as Row[])
      .map((row) => ({ id: String(row.id), sessionId, playerId, sceneId: String(row.scene_id), type: row.type as SceneLifecycleEvent["type"], sourceEventId: String(row.source_event_id), ...(row.source_action_id ? { sourceActionId: String(row.source_action_id) } : {}), payload: fromJson<Record<string, unknown>>(row.payload_json), occurredAt: String(row.occurred_at) }));
  }
  public hasSceneLifecycleSourceEvent(sourceEventId: string): boolean { return Boolean(this.db.prepare("SELECT 1 AS present FROM scene_lifecycle_events WHERE source_event_id = ? LIMIT 1").get(sourceEventId)); }
  public getInteractionPlanBySourceAction(sessionId: string, sourceActionId: string): InteractionPlan | undefined {
    const row = this.db.prepare("SELECT * FROM interaction_plans WHERE session_id = ? AND source_action_id = ?").get(sessionId, sourceActionId) as Row | undefined;
    return row ? { id: String(row.id), sessionId, playerId: String(row.player_id), sceneId: String(row.scene_id), sourceEventId: String(row.source_event_id), sourceActionId, status: row.status as InteractionPlan["status"], ...(row.response_event_id ? { responseEventId: String(row.response_event_id) } : {}), ...(row.lead_character_id ? { leadCharacterId: String(row.lead_character_id) } : {}), participants: fromJson<InteractionPlan["participants"]>(row.participants_json), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } : undefined;
  }
  public saveInteractionPlan(plan: InteractionPlan): void {
    this.db.prepare("INSERT INTO interaction_plans VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, source_action_id) DO NOTHING")
      .run(plan.id, plan.sessionId, plan.playerId, plan.sceneId, plan.sourceEventId, plan.sourceActionId, plan.status, plan.responseEventId ?? null, plan.leadCharacterId ?? null, asJson(plan.participants), plan.createdAt, plan.updatedAt);
  }
  public getInteractionExecution(sessionId: string, playerActionId: string): InteractionExecution | undefined {
    const row = this.db.prepare("SELECT * FROM interaction_executions WHERE session_id = ? AND player_action_id = ?").get(sessionId, playerActionId) as Row | undefined;
    return row ? { id: String(row.id), sessionId, playerActionId, playerId: String(row.player_id), sceneId: String(row.scene_id), action: fromJson<import("../core/contracts.js").PlayerAction>(row.action_json), ...(row.lead_character_id ? { leadCharacterId: String(row.lead_character_id) } : {}), status: row.status as InteractionExecutionStatus, attempt: Number(row.attempt), maxAttempts: Number(row.max_attempts), ...(row.reason ? { reason: String(row.reason) } : {}), ...(row.response_event_id ? { responseEventId: String(row.response_event_id) } : {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } : undefined;
  }
  public getInteractionExecutionById(id: string): InteractionExecution | undefined {
    const row = this.db.prepare("SELECT * FROM interaction_executions WHERE id = ?").get(id) as Row | undefined;
    return row ? this.getInteractionExecution(String(row.session_id), String(row.player_action_id)) : undefined;
  }
  public saveInteractionExecution(execution: InteractionExecution): void {
    this.db.prepare("INSERT INTO interaction_executions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, player_action_id) DO NOTHING")
      .run(execution.id, execution.sessionId, execution.playerActionId, execution.playerId, execution.sceneId, asJson(execution.action), execution.leadCharacterId ?? null, execution.status, execution.attempt, execution.maxAttempts, execution.reason ?? null, execution.responseEventId ?? null, execution.createdAt, execution.updatedAt);
  }
  /** Creates the workflow state and its durable delivery in one database transaction. */
  public enqueueInteractionExecution(execution: InteractionExecution): void {
    this.transaction(() => {
      this.saveInteractionExecution(execution);
      this.enqueueDurableJob({ id: randomUUID(), sessionId: execution.sessionId, kind: "interaction.execute", dedupeKey: execution.playerActionId,
        payload: { executionId: execution.id }, status: "pending", attempts: 0, maxAttempts: execution.maxAttempts,
        availableAt: execution.createdAt, createdAt: execution.createdAt });
    });
  }
  public transitionInteractionExecution(id: string, from: readonly InteractionExecutionStatus[], next: InteractionExecutionStatus, updatedAt: string, reason?: string, responseEventId?: string): boolean {
    if (!from.length) return false;
    const result = this.db.prepare(`UPDATE interaction_executions SET status = ?, updated_at = ?, reason = ?, response_event_id = ? WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`)
      .run(next, updatedAt, reason ?? null, responseEventId ?? null, id, ...from);
    return result.changes > 0;
  }
  public getProfile(sessionId: string, characterId: string): CharacterProfile | undefined {
    const row = this.db.prepare("SELECT * FROM character_profiles WHERE session_id = ? AND character_id = ?").get(sessionId, characterId) as Row | undefined;
    return row ? this.profile(row) : undefined;
  }
  public listCapabilities(sessionId: string, characterId: string): CharacterCapability[] {
    return this.db.prepare("SELECT * FROM character_capabilities WHERE session_id = ? AND character_id = ? ORDER BY category, id")
      .all(sessionId, characterId).map((row) => this.capability(row as Row));
  }
  public getLifeContext(sessionId: string, characterId: string): CharacterLifeContext | undefined {
    const row = this.db.prepare("SELECT * FROM character_life_context WHERE session_id = ? AND character_id = ?").get(sessionId, characterId) as Row | undefined;
    return row ? this.lifeContext(row) : undefined;
  }
  public listObjectiveRelationships(sessionId: string, characterId: string): ObjectiveRelationship[] {
    return this.db.prepare("SELECT * FROM objective_relationships WHERE session_id = ? AND character_id = ? ORDER BY target_id, id")
      .all(sessionId, characterId).map((row) => this.objectiveRelationship(row as Row));
  }
  public getBond(sessionId: string, playerId: string, characterId: string): CharacterBond | undefined {
    const row = this.db.prepare("SELECT * FROM character_bonds WHERE session_id = ? AND player_id = ? AND character_id = ?")
      .get(sessionId, playerId, characterId) as Row | undefined;
    return row ? { sessionId: String(row.session_id), playerId: String(row.player_id), characterId: String(row.character_id),
      level: Number(row.bond_level), points: Number(row.bond_points), totalPoints: Number(row.total_points), updatedAt: String(row.updated_at) } : undefined;
  }
  public listEvidence(sessionId: string, characterId: string, limit: number): EvidenceRecord[] {
    return this.db.prepare("SELECT * FROM character_evidence_records WHERE session_id = ? AND character_id = ? ORDER BY importance DESC, occurred_at DESC LIMIT ?").all(sessionId, characterId, limit).map((row) => this.evidence(row as Row));
  }
  public listEvidenceByIds(sessionId: string, characterId: string, ids: readonly string[]): EvidenceRecord[] {
    if (!ids.length) return [];
    const placeholders = ids.map(() => "?").join(", ");
    return this.db.prepare(`SELECT * FROM character_evidence_records WHERE session_id = ? AND character_id = ? AND id IN (${placeholders})`)
      .all(sessionId, characterId, ...ids).map((row) => this.evidence(row as Row));
  }
  public listMemoryAtoms(sessionId: string, characterId: string): MemoryAtom[] {
    return this.db.prepare("SELECT * FROM character_memory_atoms WHERE session_id = ? AND owner_id = ? ORDER BY importance DESC, occurred_at DESC")
      .all(sessionId, characterId).map((row) => this.memoryAtom(row as Row));
  }
  public listEpisodeMemories(sessionId: string, characterId: string): EpisodeMemory[] {
    return this.db.prepare("SELECT * FROM character_episode_memories WHERE session_id = ? AND owner_id = ? ORDER BY salience DESC, occurred_at DESC")
      .all(sessionId, characterId).map((row) => this.episodeMemory(row as Row));
  }
  public listPatternDrafts(sessionId: string, characterId: string): CifPatternDraft[] {
    return this.db.prepare("SELECT * FROM cif_pattern_drafts WHERE session_id = ? AND character_id = ? ORDER BY created_at DESC")
      .all(sessionId, characterId).map((row) => this.patternDraft(row as Row));
  }
  public listSceneNarrativeProjections(sessionId: string, limit: number): SceneNarrativeProjection[] {
    return this.db.prepare("SELECT * FROM scene_narrative_projections WHERE session_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(sessionId, limit).map((row) => this.narrativeProjection(row as Row));
  }
  public listEpistemicStates(sessionId: string, characterId: string, limit: number): EpistemicState[] {
    const rows = this.db.prepare("SELECT * FROM character_epistemic_states WHERE session_id = ? AND character_id = ? ORDER BY version DESC, updated_at DESC").all(sessionId, characterId).map((row) => this.epistemic(row as Row));
    const propositions = new Set<string>();
    return rows.filter((state) => !propositions.has(state.proposition) && (propositions.add(state.proposition), true)).slice(0, limit);
  }
  public listInterpretiveModels(sessionId: string, characterId: string, limit: number, targetIds?: readonly string[]): InterpretiveModel[] {
    const rows = targetIds?.length
      ? this.db.prepare(`SELECT * FROM character_interpretive_models WHERE session_id = ? AND character_id = ? AND (target_id IS NULL OR target_id IN (${targetIds.map(() => "?").join(", ")})) ORDER BY version DESC, updated_at DESC`).all(sessionId, characterId, ...targetIds)
      : this.db.prepare("SELECT * FROM character_interpretive_models WHERE session_id = ? AND character_id = ? ORDER BY version DESC, updated_at DESC").all(sessionId, characterId);
    const socialTargets = new Set<string>();
    return rows.map((row) => this.interpretive(row as Row)).filter((model) => model.kind !== "social" || !model.targetId || !socialTargets.has(model.targetId) && (socialTargets.add(model.targetId), true)).slice(0, limit);
  }
  public getRuntimeState(sessionId: string, characterId: string): CharacterRuntimeState | undefined {
    const row = this.db.prepare("SELECT * FROM character_runtime_states WHERE session_id = ? AND character_id = ?").get(sessionId, characterId) as Row | undefined;
    return row ? { sessionId, characterId, attention: fromJson<string[]>(row.attention_json), emotions: fromJson<CharacterRuntimeState["emotions"]>(row.emotions_json), activeGoals: fromJson<string[]>(row.active_goals_json), ...(row.location_id ? { locationId: String(row.location_id) } : {}), ...(row.availability ? { availability: row.availability as CharacterRuntimeState["availability"] } : {}), ...(row.current_intention ? { currentIntention: String(row.current_intention) } : {}), ...(row.current_plan ? { currentPlan: String(row.current_plan) } : {}), ...(row.expression_strategy ? { expressionStrategy: String(row.expression_strategy) } : {}), ...(row.last_proactive_interaction_tick !== null ? { lastProactiveInteractionTick: Number(row.last_proactive_interaction_tick) } : {}), ...(row.known_player_location_id ? { knownPlayerLocationId: String(row.known_player_location_id) } : {}), ...(row.approach_player ? { approachPlayer: row.approach_player as CharacterRuntimeState["approachPlayer"] } : {}), updatedAt: String(row.updated_at) } : undefined;
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

  private migrateSchema(): void {
    const columns = new Set((this.db.prepare("PRAGMA table_info(objective_history)").all() as Row[]).map((row) => String(row.name)));
    if (!columns.has("causation_json")) this.db.exec("ALTER TABLE objective_history ADD COLUMN causation_json TEXT NOT NULL DEFAULT '{}'");
    if (!columns.has("state_revision")) this.db.exec("ALTER TABLE objective_history ADD COLUMN state_revision INTEGER NOT NULL DEFAULT 0");
    if (!columns.has("moment_json")) this.db.exec("ALTER TABLE objective_history ADD COLUMN moment_json TEXT");
    const runtimeStateColumns = new Set((this.db.prepare("PRAGMA table_info(character_runtime_states)").all() as Row[]).map((row) => String(row.name)));
    if (!runtimeStateColumns.has("last_proactive_interaction_tick")) this.db.exec("ALTER TABLE character_runtime_states ADD COLUMN last_proactive_interaction_tick INTEGER");
    if (!runtimeStateColumns.has("known_player_location_id")) this.db.exec("ALTER TABLE character_runtime_states ADD COLUMN known_player_location_id TEXT");
    if (!runtimeStateColumns.has("approach_player")) this.db.exec("ALTER TABLE character_runtime_states ADD COLUMN approach_player TEXT");
    const processedActionColumns = new Set((this.db.prepare("PRAGMA table_info(processed_actions)").all() as Row[]).map((row) => String(row.name)));
    if (!processedActionColumns.has("request_fingerprint")) this.db.exec("ALTER TABLE processed_actions ADD COLUMN request_fingerprint TEXT");
    const patternDraftColumns = new Set((this.db.prepare("PRAGMA table_info(cif_pattern_drafts)").all() as Row[]).map((row) => String(row.name)));
    if (!patternDraftColumns.has("audit_json")) this.db.exec("ALTER TABLE cif_pattern_drafts ADD COLUMN audit_json TEXT");
    if (!patternDraftColumns.has("reviewed_at")) this.db.exec("ALTER TABLE cif_pattern_drafts ADD COLUMN reviewed_at TEXT");
    if (!patternDraftColumns.has("published_at")) this.db.exec("ALTER TABLE cif_pattern_drafts ADD COLUMN published_at TEXT");
    const l3DraftColumns = new Set((this.db.prepare("PRAGMA table_info(cif_l3_revision_drafts)").all() as Row[]).map((row) => String(row.name)));
    if (!l3DraftColumns.has("audit_json")) this.db.exec("ALTER TABLE cif_l3_revision_drafts ADD COLUMN audit_json TEXT");
    const interactionPlanColumns = new Set((this.db.prepare("PRAGMA table_info(interaction_plans)").all() as Row[]).map((row) => String(row.name)));
    if (!interactionPlanColumns.has("response_event_id")) this.db.exec("ALTER TABLE interaction_plans ADD COLUMN response_event_id TEXT");
    const interactionExecutionColumns = new Set((this.db.prepare("PRAGMA table_info(interaction_executions)").all() as Row[]).map((row) => String(row.name)));
    if (!interactionExecutionColumns.has("action_json")) this.db.exec("ALTER TABLE interaction_executions ADD COLUMN action_json TEXT NOT NULL DEFAULT '{}'");
    this.recordSchemaMigration("2026-08-event-envelope-v1");
    this.recordSchemaMigration("2026-08-durable-jobs-v1");
    this.recordSchemaMigration("2026-08-processed-action-fingerprint-v1");
    this.recordSchemaMigration("2026-08-game-moment-v1");
    this.recordSchemaMigration("2026-08-proactive-interaction-v1");
    this.recordSchemaMigration("2026-08-player-approach-v1");
    this.recordSchemaMigration("2026-08-cif-pattern-draft-review-v1");
    this.recordSchemaMigration("2026-08-cognitive-audit-v1");
    this.recordSchemaMigration("2026-08-cif-l3-revision-v1");
    this.recordSchemaMigration("2026-08-scene-lifecycle-v1");
    this.recordSchemaMigration("2026-08-interaction-coordinator-v1");
    this.recordSchemaMigration("2026-08-interaction-execution-v1");
  }
  private recordSchemaMigration(version: string): void {
    this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?) ON CONFLICT(version) DO NOTHING")
      .run(version, new Date().toISOString());
  }
  private historyEvent(row: Row): GameEvent {
    return { id: String(row.id), sessionId: String(row.session_id), sequence: Number(row.sequence), type: String(row.event_type) as GameEvent["type"],
      payload: fromJson<Record<string, unknown>>(row.payload_json), causation: fromJson<GameEvent["causation"]>(row.causation_json ?? "{}"),
      stateRevision: Number(row.state_revision ?? 0), ...(row.moment_json ? { moment: fromJson<GameEvent["moment"]>(row.moment_json) } : {}), createdAt: String(row.created_at) };
  }
  private durableJob(row: Row): DurableJob {
    return {
      id: String(row.id), sessionId: String(row.session_id), kind: String(row.kind), dedupeKey: String(row.dedupe_key),
      payload: fromJson<Record<string, unknown>>(row.payload_json), status: row.status as DurableJob["status"],
      attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts), availableAt: String(row.available_at),
      ...(row.leased_at ? { leasedAt: String(row.leased_at) } : {}),
      ...(row.lease_owner ? { leaseOwner: String(row.lease_owner) } : {}),
      ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}),
      ...(row.error ? { error: String(row.error) } : {}), createdAt: String(row.created_at),
    };
  }
  private branchFact(row: Row): BranchFact {
    return { id: String(row.id), sessionId: String(row.session_id), factKey: String(row.fact_key),
      value: fromJson<Record<string, unknown>>(row.value_json), sourceEventIds: fromJson<string[]>(row.source_event_ids_json), updatedAt: String(row.updated_at) };
  }
  private branchProgress(row: Row): BranchProgress {
    return {
      sessionId: String(row.session_id), playerId: String(row.player_id), contentType: row.content_type as BranchProgress["contentType"], contentId: String(row.content_id),
      ...(row.active_node_id ? { activeNodeId: String(row.active_node_id) } : {}), status: row.status as BranchProgress["status"],
      completedNodeIds: fromJson<string[]>(row.completed_node_ids_json), divertedNodeIds: fromJson<string[]>(row.diverted_node_ids_json),
      blockedNodeIds: fromJson<string[]>(row.blocked_node_ids_json), updatedAt: String(row.updated_at),
    };
  }
  private worldlineDivergence(row: Row): WorldlineDivergence {
    return {
      id: String(row.id), sessionId: String(row.session_id), canonAnchor: String(row.canon_anchor),
      sourceEventIds: fromJson<string[]>(row.source_event_ids_json), changedFactKey: String(row.changed_fact_key),
      canonBaseline: fromJson<Record<string, unknown>>(row.canon_baseline_json), branchReality: fromJson<Record<string, unknown>>(row.branch_reality_json),
      significance: row.significance as WorldlineDivergence["significance"], affectedScope: row.affected_scope as WorldlineDivergence["affectedScope"],
      knownImpactNodeIds: fromJson<string[]>(row.known_impact_node_ids_json), pendingImpactChapterIds: fromJson<string[]>(row.pending_impact_chapter_ids_json),
      status: row.status as WorldlineDivergence["status"], rationale: String(row.rationale), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    };
  }
  private storyChapterPackage(row: Row): PersistedStoryChapterPackage {
    const definition = fromJson<{ nodeRules: PersistedStoryChapterPackage["nodeRules"]; assessmentPolicies?: PersistedStoryChapterPackage["assessmentPolicies"] }>(row.definition_json);
    return {
      sessionId: String(row.session_id), packageId: String(row.package_id), contentType: row.content_type as PersistedStoryChapterPackage["contentType"], contentId: String(row.content_id),
      canonAnchor: String(row.canon_anchor), entryNodeId: String(row.entry_node_id), sourceFragmentIds: fromJson<string[]>(row.source_fragment_ids_json),
      nodeRules: definition.nodeRules, ...(definition.assessmentPolicies?.length ? { assessmentPolicies: definition.assessmentPolicies } : {}), status: row.status as PersistedStoryChapterPackage["status"], version: Number(row.version),
      activatedAt: String(row.activated_at), ...(row.invalidated_at ? { invalidatedAt: String(row.invalidated_at) } : {}),
    };
  }

  private identity(row: Row): IdentityModel { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), section: row.section as IdentityModel["section"], content: String(row.content), sourceIds: fromJson<string[]>(row.source_ids_json), version: Number(row.version), origin: row.origin as IdentityModel["origin"], reviewStatus: row.review_status as IdentityModel["reviewStatus"] }; }
  private profile(row: Row): CharacterProfile { return { sessionId: String(row.session_id), characterId: String(row.character_id), variantId: String(row.variant_id), storyPointId: String(row.story_point_id), displayName: String(row.display_name), aliases: fromJson<string[]>(row.aliases_json), ...(row.age_or_life_stage ? { ageOrLifeStage: String(row.age_or_life_stage) } : {}), ...(row.social_identity ? { socialIdentity: String(row.social_identity) } : {}), ...(row.affiliation ? { affiliation: String(row.affiliation) } : {}), ...(row.home_region ? { homeRegion: String(row.home_region) } : {}), ...(row.objective_status ? { objectiveStatus: String(row.objective_status) } : {}), sourceIds: fromJson<string[]>(row.source_ids_json), version: Number(row.version) }; }
  private capability(row: Row): CharacterCapability { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), category: row.category as CharacterCapability["category"], content: String(row.content), mechanicalTags: fromJson<string[]>(row.mechanical_tags_json), sourceIds: fromJson<string[]>(row.source_ids_json), version: Number(row.version) }; }
  private lifeContext(row: Row): CharacterLifeContext { return { sessionId: String(row.session_id), characterId: String(row.character_id), scheduleSummary: row.schedule_summary ? String(row.schedule_summary) : undefined, responsibilities: fromJson<string[]>(row.responsibilities_json), currentProblems: fromJson<string[]>(row.current_problems_json), availableResources: fromJson<string[]>(row.available_resources_json), missingResources: fromJson<string[]>(row.missing_resources_json), independentLifeSummary: row.independent_life_summary ? String(row.independent_life_summary) : undefined, sourceIds: fromJson<string[]>(row.source_ids_json), version: Number(row.version) }; }
  private objectiveRelationship(row: Row): ObjectiveRelationship { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), targetId: String(row.target_id), relationType: String(row.relation_type), sharedHistorySummary: row.shared_history_summary ? String(row.shared_history_summary) : undefined, currentObjectiveStatus: row.current_objective_status ? String(row.current_objective_status) : undefined, sourceIds: fromJson<string[]>(row.source_ids_json), version: Number(row.version) }; }
  private evidence(row: Row): EvidenceRecord { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), kind: row.kind as EvidenceRecord["kind"], content: String(row.content), sourceEventIds: fromJson<string[]>(row.source_event_ids_json), ...(row.source_type ? { sourceType: row.source_type as EvidenceRecord["sourceType"] } : {}), ...(row.source_trust !== null ? { sourceTrust: Number(row.source_trust) } : {}), ...(row.verified_status ? { verifiedStatus: row.verified_status as EvidenceRecord["verifiedStatus"] } : {}), ...(row.sensory_impression ? { sensoryImpression: String(row.sensory_impression) } : {}), recallCues: fromJson<string[]>(row.recall_cues_json ?? "[]"), reliability: Number(row.reliability), importance: Number(row.importance), occurredAt: String(row.occurred_at) }; }
  private memoryAtom(row: Row): MemoryAtom { return { id: String(row.id), sessionId: String(row.session_id), ownerId: String(row.owner_id), content: String(row.content), kind: row.kind as MemoryAtom["kind"], sourceEventIds: fromJson<string[]>(row.source_event_ids_json), participantIds: fromJson<string[]>(row.participant_ids_json), ...(row.location_id ? { locationId: String(row.location_id) } : {}), recallCues: fromJson<string[]>(row.recall_cues_json), confidence: Number(row.confidence), importance: Number(row.importance), occurredAt: String(row.occurred_at) }; }
  private episodeMemory(row: Row): EpisodeMemory { return { id: String(row.id), sessionId: String(row.session_id), ownerId: String(row.owner_id), sourceEventIds: fromJson<string[]>(row.source_event_ids_json), factualAnchorIds: fromJson<string[]>(row.factual_anchor_ids_json), summary: String(row.summary), ...(row.subjective_interpretation ? { subjectiveInterpretation: String(row.subjective_interpretation) } : {}), emotions: fromJson<EpisodeMemory["emotions"]>(row.emotions_json), participantIds: fromJson<string[]>(row.participant_ids_json), ...(row.location_id ? { locationId: String(row.location_id) } : {}), salience: Number(row.salience), status: row.status as EpisodeMemory["status"], recallCues: fromJson<string[]>(row.recall_cues_json ?? "[]"), occurredAt: String(row.occurred_at) }; }
  private patternDraft(row: Row): CifPatternDraft { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), triggerEpisodeId: String(row.trigger_episode_id), status: row.status as CifPatternDraft["status"], proposal: fromJson<CifPatternDraft["proposal"]>(row.proposal_json), validationErrors: fromJson<string[]>(row.validation_errors_json), ...(row.audit_json ? { audit: fromJson<NonNullable<CifPatternDraft["audit"]>>(row.audit_json) } : {}), generator: String(row.generator), createdAt: String(row.created_at), ...(row.reviewed_at ? { reviewedAt: String(row.reviewed_at) } : {}), ...(row.published_at ? { publishedAt: String(row.published_at) } : {}) }; }
  private l3RevisionDraft(row: Row): CifL3RevisionDraft { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), triggerEpisodeId: String(row.trigger_episode_id), status: row.status as CifL3RevisionDraft["status"], proposal: fromJson<CifL3RevisionDraft["proposal"]>(row.proposal_json), validationErrors: fromJson<string[]>(row.validation_errors_json), ...(row.audit_json ? { audit: fromJson<NonNullable<CifL3RevisionDraft["audit"]>>(row.audit_json) } : {}), generator: String(row.generator), createdAt: String(row.created_at), ...(row.reviewed_at ? { reviewedAt: String(row.reviewed_at) } : {}), ...(row.published_at ? { publishedAt: String(row.published_at) } : {}) }; }
  private memoryTask(row: Row): MemoryConsolidationTask { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), trigger: row.trigger as MemoryConsolidationTask["trigger"], sourceEvidenceIds: fromJson<string[]>(row.source_evidence_ids_json), participantIds: fromJson<string[]>(row.participant_ids_json), locationId: row.location_id ? String(row.location_id) : undefined, status: row.status as MemoryConsolidationTask["status"], attempts: Number(row.attempts ?? 0), createdAt: String(row.created_at), availableAt: row.available_at ? String(row.available_at) : undefined, leasedAt: row.leased_at ? String(row.leased_at) : undefined, completedAt: row.completed_at ? String(row.completed_at) : undefined, error: row.error ? String(row.error) : undefined }; }
  private narrativeProjection(row: Row): SceneNarrativeProjection { return { id: String(row.id), sessionId: String(row.session_id), sourceEventIds: fromJson<string[]>(row.source_event_ids_json), participantIds: fromJson<string[]>(row.participant_ids_json), locationId: row.location_id ? String(row.location_id) : undefined, publicSummary: String(row.public_summary), openThreads: fromJson<string[]>(row.open_threads_json), storyPressures: fromJson<string[]>(row.story_pressures_json), createdAt: String(row.created_at) }; }
  private epistemic(row: Row): EpistemicState { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), proposition: String(row.proposition), status: row.status as EpistemicState["status"], confidence: Number(row.confidence), supportingEvidenceIds: fromJson<string[]>(row.supporting_evidence_ids_json), opposingEvidenceIds: fromJson<string[]>(row.opposing_evidence_ids_json), version: Number(row.version) }; }
  private interpretive(row: Row): InterpretiveModel { return { id: String(row.id), sessionId: String(row.session_id), characterId: String(row.character_id), kind: row.kind as InterpretiveModel["kind"], ...(row.target_id ? { targetId: String(row.target_id) } : {}), content: String(row.content), activation: Number(row.activation), supportingEvidenceIds: fromJson<string[]>(row.supporting_evidence_ids_json), opposingEvidenceIds: fromJson<string[]>(row.opposing_evidence_ids_json), ...(row.scope ? { scope: String(row.scope) } : {}), ...(row.stability ? { stability: row.stability as InterpretiveModel["stability"] } : {}), exceptions: fromJson<string[]>(row.exceptions_json ?? "[]"), changeConditions: fromJson<string[]>(row.change_conditions_json ?? "[]"), ...(row.predicted_behavior ? { predictedBehavior: String(row.predicted_behavior) } : {}), perceivedValues: fromJson<string[]>(row.perceived_values_json ?? "[]"), perceivedFears: fromJson<string[]>(row.perceived_fears_json ?? "[]"), ...(row.believed_view_of_self ? { believedViewOfSelf: String(row.believed_view_of_self) } : {}), expectedActions: fromJson<string[]>(row.expected_actions_json ?? "[]"), fearedActions: fromJson<string[]>(row.feared_actions_json ?? "[]"), revisionConditions: fromJson<string[]>(row.revision_conditions_json ?? "[]"), version: Number(row.version) }; }
  private initializationDraft(row: Row): CifInitializationDraftRecord {
    return { id: String(row.id), status: row.status as CifInitializationDraftRecord["status"], brief: fromJson<CifInitializationDraftRecord["brief"]>(row.brief_json), draft: fromJson<CifInitializationDraftRecord["draft"]>(row.draft_json), validationErrors: fromJson<string[]>(row.validation_errors_json), generator: String(row.generator), createdAt: String(row.created_at), reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined };
  }

}
