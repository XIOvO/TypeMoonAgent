import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  restoreSqliteMigrationBackup,
  SqliteMigrationApplyError,
  SqliteMigrationOperations,
  type SqliteMigrationDefinition,
} from "./sqlite-migration-operations.js";

type Row = Record<string, unknown>;

test("dry-run reports ordered work and leaves the database byte-for-byte unchanged", async (context) => {
  const directory = await temporaryDirectory(context);
  const databasePath = join(directory, "game.sqlite");
  createDatabase(databasePath, (database) => {
    database.exec(`
      CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
      INSERT INTO schema_migrations VALUES ('001-existing', 'sum-001', '2026-08-21T00:00:00.000Z');
    `);
  });
  let applyCalls = 0;
  const operations = new SqliteMigrationOperations({
    databasePath,
    migrations: [
      migration("003-last", "sum-003", () => { applyCalls += 1; }),
      migration("001-existing", "sum-001", () => { applyCalls += 1; }),
      migration("002-next", "sum-002", () => { applyCalls += 1; }),
    ],
  });
  const beforeBytes = await readFile(databasePath);
  const beforeFiles = await readdir(directory);

  const plan = await operations.dryRun();

  assert.deepEqual(plan.applied, [{ id: "001-existing", checksum: "sum-001" }]);
  assert.deepEqual(plan.pending, ["002-next", "003-last"]);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.backupRequired, true);
  assert.equal(applyCalls, 0);
  assert.deepEqual(await readFile(databasePath), beforeBytes);
  assert.deepEqual(await readdir(directory), beforeFiles);
});

test("apply backs up first, migrates in order, and is idempotent", async (context) => {
  const directory = await temporaryDirectory(context);
  const databasePath = join(directory, "game.sqlite");
  createDatabase(databasePath);
  const operations = new SqliteMigrationOperations({
    databasePath,
    now: () => "2026-08-21T01:02:03.004Z",
    migrations: [
      migration("002-index", "sum-002", (database) => database.exec("CREATE INDEX marker_value_idx ON marker(value)")),
      migration("001-column", "sum-001", (database) => database.exec("ALTER TABLE marker ADD COLUMN note TEXT")),
    ],
  });

  const result = await operations.apply();

  assert.deepEqual(result.completedIds, ["001-column", "002-index"]);
  assert.equal(result.backupPath, `${databasePath}.2026-08-21T01-02-03-004Z.bak`);
  const live = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.deepEqual(
      (live.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version").all() as Row[])
        .map((row) => [String(row.version), String(row.checksum)]),
      [["001-column", "sum-001"], ["002-index", "sum-002"]],
    );
    assert.equal((live.prepare("SELECT note FROM marker").get() as Row).note, null);
  } finally {
    live.close();
  }
  const saved = new DatabaseSync(result.backupPath!, { readOnly: true });
  try {
    assert.equal(saved.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get(), undefined);
    assert.equal((saved.prepare("SELECT COUNT(*) AS count FROM marker").get() as Row).count, 1);
  } finally {
    saved.close();
  }

  const second = await operations.apply();
  assert.deepEqual(second.completedIds, []);
  assert.equal(second.backupPath, undefined);
});

test("a failed migration rolls back only itself, stops the run, and preserves a restorable backup", async (context) => {
  const directory = await temporaryDirectory(context);
  const databasePath = join(directory, "game.sqlite");
  const restoredPath = join(directory, "restored.sqlite");
  createDatabase(databasePath);
  let thirdCalled = false;
  const operations = new SqliteMigrationOperations({
    databasePath,
    now: () => "2026-08-21T02:00:00.000Z",
    migrations: [
      migration("001-commit", "sum-001", (database) => database.exec("CREATE TABLE committed (id INTEGER PRIMARY KEY) STRICT")),
      migration("002-fail", "sum-002", (database) => {
        database.exec("CREATE TABLE rolled_back (id INTEGER PRIMARY KEY) STRICT");
        throw new Error("planned_failure");
      }),
      migration("003-never", "sum-003", () => { thirdCalled = true; }),
    ],
  });

  let failure: unknown;
  try {
    await operations.apply();
  } catch (cause) {
    failure = cause;
  }
  assert.ok(failure instanceof SqliteMigrationApplyError);
  assert.equal(failure.migrationId, "002-fail");
  assert.deepEqual(failure.completedIds, ["001-commit"]);
  assert.equal(thirdCalled, false);

  const live = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.ok(live.prepare("SELECT name FROM sqlite_master WHERE name = 'committed'").get());
    assert.equal(live.prepare("SELECT name FROM sqlite_master WHERE name = 'rolled_back'").get(), undefined);
    assert.deepEqual(
      (live.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Row[]).map((row) => String(row.version)),
      ["001-commit"],
    );
  } finally {
    live.close();
  }

  await restoreSqliteMigrationBackup({ backupPath: failure.backupPath, targetPath: restoredPath });
  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  try {
    assert.equal(restored.prepare("SELECT name FROM sqlite_master WHERE name = 'committed'").get(), undefined);
    assert.equal((restored.prepare("SELECT value FROM marker").get() as Row).value, "baseline");
  } finally {
    restored.close();
  }
  await assert.rejects(
    restoreSqliteMigrationBackup({ backupPath: failure.backupPath, targetPath: restoredPath }),
    /migration_restore_target_exists/,
  );
  await restoreSqliteMigrationBackup({ backupPath: failure.backupPath, targetPath: restoredPath, overwrite: true });
});

test("preflight rejects missing databases, future schemas, and checksum conflicts before backup", async (context) => {
  const directory = await temporaryDirectory(context);
  const missingPath = join(directory, "missing.sqlite");
  await assert.rejects(
    new SqliteMigrationOperations({ databasePath: missingPath, migrations: [] }).dryRun(),
    /migration_database_missing/,
  );
  assert.deepEqual(await readdir(directory), []);

  const futurePath = join(directory, "future.sqlite");
  createDatabase(futurePath, (database) => database.exec("PRAGMA user_version = 2"));
  await assert.rejects(
    new SqliteMigrationOperations({ databasePath: futurePath, migrations: [] }).dryRun(),
    /persistence_schema_version_unsupported/,
  );

  const conflictPath = join(directory, "conflict.sqlite");
  createDatabase(conflictPath, (database) => database.exec(`
    CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
    INSERT INTO schema_migrations VALUES ('001', 'old-sum', '2026-08-21T00:00:00.000Z');
  `));
  const conflict = new SqliteMigrationOperations({
    databasePath: conflictPath,
    migrations: [migration("001", "new-sum", () => undefined)],
    now: () => "2026-08-21T03:00:00.000Z",
  });
  const plan = await conflict.dryRun();
  assert.deepEqual(plan.conflicts, [{ id: "001", appliedChecksum: "old-sum", registeredChecksum: "new-sum" }]);
  await assert.rejects(conflict.apply(), /migration_checksum_conflict:001/);
  assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith(".bak")), []);
});

function migration(id: string, checksum: string, apply: SqliteMigrationDefinition["apply"]): SqliteMigrationDefinition {
  return { id, checksum, apply };
}

function createDatabase(path: string, extend?: (database: DatabaseSync) => void): void {
  const database = new DatabaseSync(path);
  try {
    database.exec("CREATE TABLE marker (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT; INSERT INTO marker VALUES (1, 'baseline')");
    extend?.(database);
  } finally {
    database.close();
  }
}

async function temporaryDirectory(context: { after(callback: () => Promise<void>): void }): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agent-game-migrations-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
