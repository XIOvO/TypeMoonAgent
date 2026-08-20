# Persistence Operations Contract

## Scope

This contract governs schema migrations for a local SQLite game database. It
does not authorize remote database access, automatic backups outside the
configured local directory, or destructive repair.

## Preflight

Before any non-dry migration run, the operator must provide an explicit
database path and the runner must:

1. open the database without applying migrations;
2. read `schema_migrations` and compare registered checksums;
3. reject checksum conflicts and unsupported future persistence versions;
4. report pending migration IDs in execution order;
5. create a timestamped backup beside the database, then verify the backup
   file exists before applying the first migration.

## Dry Run

`dry-run` may read the database and migration registry, but must not:

- create or modify the database;
- create a backup;
- execute a migration body;
- write `schema_migrations`;
- alter a table, index, trigger, or application data.

Its result reports the current applied migrations, pending migrations, checksum
conflicts, and whether a real run would require a backup.

## Apply and Failure Recovery

Each migration is applied in its own database transaction. A migration record
is written only after its transaction succeeds. If a migration fails:

- stop immediately; do not attempt later migrations;
- preserve the backup created before the run;
- report the failed migration ID and the original error;
- leave the database at the last successfully recorded migration;
- require an operator decision to restore the backup or repair the migration.

The runner never automatically restores a backup, deletes a database, changes
checksums, or retries a failed migration.

## Restore

Restoration is a separate explicit operation. It must verify the selected
backup exists and must refuse to overwrite a target unless the operator has
explicitly selected that target. The restore command should first support a
copy to a new path; replacement of the live database remains an operator-owned
action.

## Exit Conditions

| Condition | Result |
| --- | --- |
| No pending migrations | success, no writes |
| Dry run with pending migrations | success, no writes |
| Checksum conflict or future version | rejected, no writes |
| Backup creation/verification failure | rejected, no migration writes |
| Migration failure | stopped; backup retained; no later migration runs |
| All migrations recorded | success; report backup path and applied IDs |
