import { constants as fsConstants } from "node:fs";
import { access, copyFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { CURRENT_PERSISTENCE_SCHEMA_VERSION } from "../protocol/persistence-versioning.js";

type Row = Record<string, unknown>;

export interface SqliteMigrationDefinition {
  id: string;
  checksum: string;
  /** Migration bodies are synchronous so the transaction cannot outlive the callback. */
  apply(database: DatabaseSync): void;
}

export interface SqliteMigrationPlan {
  databasePath: string;
  applied: readonly Readonly<{ id: string; checksum: string }>[];
  pending: readonly string[];
  conflicts: readonly Readonly<{ id: string; appliedChecksum: string; registeredChecksum: string }>[];
  backupRequired: boolean;
}

export interface SqliteMigrationApplyResult {
  plan: SqliteMigrationPlan;
  completedIds: readonly string[];
  backupPath?: string;
}

export class SqliteMigrationApplyError extends Error {
  public readonly code = "migration_apply_failed";

  public constructor(
    public readonly migrationId: string,
    public readonly backupPath: string,
    public readonly completedIds: readonly string[],
    options: ErrorOptions,
  ) {
    super(`migration_apply_failed:${migrationId}`, options);
    this.name = "SqliteMigrationApplyError";
  }
}

export interface SqliteMigrationOperationsOptions {
  databasePath: string;
  migrations: readonly SqliteMigrationDefinition[];
  now?: () => string;
}

export class SqliteMigrationOperations {
  private readonly databasePath: string;
  private readonly migrations: readonly SqliteMigrationDefinition[];
  private readonly now: () => string;

  public constructor(options: SqliteMigrationOperationsOptions) {
    if (!isAbsolute(options.databasePath) || options.databasePath === ":memory:") throw new Error("migration_database_path_invalid");
    const seen = new Set<string>();
    for (const migration of options.migrations) {
      if (!migration.id || !migration.checksum) throw new Error("migration_invalid");
      if (seen.has(migration.id)) throw new Error("migration_duplicate");
      seen.add(migration.id);
    }
    this.databasePath = resolve(options.databasePath);
    this.migrations = [...options.migrations].sort((left, right) => left.id.localeCompare(right.id));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Opens the existing database read-only and performs no filesystem writes. */
  public async dryRun(): Promise<SqliteMigrationPlan> {
    await requireFile(this.databasePath, "migration_database_missing");
    const database = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      const version = Number((database.prepare("PRAGMA user_version").get() as Row).user_version);
      if (!Number.isSafeInteger(version) || version > CURRENT_PERSISTENCE_SCHEMA_VERSION) {
        throw new Error("persistence_schema_version_unsupported");
      }
      const applied = readApplied(database);
      const registered = new Map(this.migrations.map((migration) => [migration.id, migration]));
      const conflicts = applied.flatMap((record) => {
        const migration = registered.get(record.id);
        return migration && migration.checksum !== record.checksum
          ? [{ id: record.id, appliedChecksum: record.checksum, registeredChecksum: migration.checksum }]
          : [];
      });
      const appliedIds = new Set(applied.map((record) => record.id));
      const pending = this.migrations.filter((migration) => !appliedIds.has(migration.id)).map((migration) => migration.id);
      return { databasePath: this.databasePath, applied, pending, conflicts, backupRequired: pending.length > 0 };
    } finally {
      database.close();
    }
  }

  public async apply(): Promise<SqliteMigrationApplyResult> {
    const plan = await this.dryRun();
    if (plan.conflicts.length) throw new Error(`migration_checksum_conflict:${plan.conflicts[0]!.id}`);
    if (!plan.pending.length) return { plan, completedIds: [] };

    const backupPath = `${this.databasePath}.${safeTimestamp(this.now())}.bak`;
    if (await exists(backupPath)) throw new Error("migration_backup_exists");
    const source = new DatabaseSync(this.databasePath, { readOnly: true });
    try {
      await backup(source, backupPath);
    } finally {
      source.close();
    }
    validateSqliteFile(backupPath, "migration_backup_invalid");

    const database = new DatabaseSync(this.databasePath);
    const completedIds: string[] = [];
    try {
      ensureMigrationTable(database);
      for (const id of plan.pending) {
        const migration = this.migrations.find((candidate) => candidate.id === id)!;
        database.exec("BEGIN IMMEDIATE");
        try {
          migration.apply(database);
          database.prepare("INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)")
            .run(migration.id, migration.checksum, this.now());
          database.exec("COMMIT");
          completedIds.push(migration.id);
        } catch (cause) {
          if (database.isTransaction) database.exec("ROLLBACK");
          throw new SqliteMigrationApplyError(migration.id, backupPath, [...completedIds], { cause });
        }
      }
    } finally {
      database.close();
    }
    return { plan, completedIds, backupPath };
  }
}

export async function restoreSqliteMigrationBackup(input: {
  backupPath: string;
  targetPath: string;
  overwrite?: boolean;
}): Promise<void> {
  if (!isAbsolute(input.backupPath) || !isAbsolute(input.targetPath)) throw new Error("migration_restore_path_invalid");
  const backupPath = resolve(input.backupPath);
  const targetPath = resolve(input.targetPath);
  if (backupPath === targetPath) throw new Error("migration_restore_path_invalid");
  await requireFile(backupPath, "migration_backup_missing");
  validateSqliteFile(backupPath, "migration_backup_invalid");
  if (!input.overwrite && await exists(targetPath)) throw new Error("migration_restore_target_exists");
  await copyFile(backupPath, targetPath, input.overwrite ? 0 : fsConstants.COPYFILE_EXCL);
  validateSqliteFile(targetPath, "migration_restore_invalid");
}

function readApplied(database: DatabaseSync): Array<{ id: string; checksum: string }> {
  const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!table) return [];
  const columns = new Set((database.prepare("PRAGMA table_info(schema_migrations)").all() as Row[]).map((row) => String(row.name)));
  if (!columns.has("version")) throw new Error("migration_table_invalid");
  const checksum = columns.has("checksum") ? "checksum" : "'legacy' AS checksum";
  return (database.prepare(`SELECT version, ${checksum} FROM schema_migrations ORDER BY version`).all() as Row[])
    .map((row) => ({ id: String(row.version), checksum: String(row.checksum) }));
}

function ensureMigrationTable(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT");
    const columns = new Set((database.prepare("PRAGMA table_info(schema_migrations)").all() as Row[]).map((row) => String(row.name)));
    if (!columns.has("version")) throw new Error("migration_table_invalid");
    if (!columns.has("checksum")) database.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT NOT NULL DEFAULT 'legacy'");
    if (!columns.has("applied_at")) database.exec("ALTER TABLE schema_migrations ADD COLUMN applied_at TEXT NOT NULL DEFAULT 'legacy'");
    database.exec("COMMIT");
  } catch (cause) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw cause;
  }
}

function validateSqliteFile(path: string, code: string): void {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    const row = database.prepare("PRAGMA quick_check").get() as Row;
    if (String(row.quick_check) !== "ok") throw new Error(code);
  } catch (cause) {
    if (cause instanceof Error && cause.message === code) throw cause;
    throw new Error(code, { cause });
  } finally {
    database?.close();
  }
}

async function requireFile(path: string, code: string): Promise<void> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new Error(code);
  } catch (cause) {
    if (cause instanceof Error && cause.message === code) throw cause;
    throw new Error(code, { cause });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function safeTimestamp(value: string): string {
  return value.replace(/[^0-9A-Za-z_-]/g, "-");
}
