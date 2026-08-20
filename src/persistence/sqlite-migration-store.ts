import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { MigrationRecord, MigrationStore } from "./contracts/index.js";

/** SQLite persistence for MigrationRunner records. */
export class SqliteMigrationStore implements MigrationStore {
  public constructor(private readonly repository: SqliteCifRepository) {}
  public async listApplied(): Promise<MigrationRecord[]> { return this.repository.listSchemaMigrations(); }
  public async recordApplied(migration: MigrationRecord): Promise<void> { this.repository.recordSchemaMigrationRecord(migration); }
}
