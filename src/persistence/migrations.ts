import type { MigrationStore } from "./contracts/index.js";

export interface Migration {
  id: string;
  checksum: string;
  apply(): void | Promise<void>;
}

export class MigrationRegistry {
  private readonly migrations = new Map<string, Migration>();

  public register(migration: Migration): void {
    if (!migration.id || !migration.checksum) throw new Error("migration_invalid");
    if (this.migrations.has(migration.id)) throw new Error("migration_duplicate");
    this.migrations.set(migration.id, migration);
  }

  public list(): readonly Migration[] { return [...this.migrations.values()].sort((left, right) => left.id.localeCompare(right.id)); }
}

export class MigrationRunner {
  public constructor(private readonly store: MigrationStore, private readonly now: () => string = () => new Date().toISOString()) {}

  public async run(registry: MigrationRegistry): Promise<readonly string[]> {
    const applied = new Map((await this.store.listApplied()).map((record) => [record.id, record]));
    const completed: string[] = [];
    for (const migration of registry.list()) {
      const existing = applied.get(migration.id);
      if (existing) {
        if (existing.checksum !== migration.checksum) throw new Error("migration_checksum_conflict");
        continue;
      }
      await migration.apply();
      await this.store.recordApplied({ id: migration.id, checksum: migration.checksum, appliedAt: this.now() });
      completed.push(migration.id);
    }
    return completed;
  }
}
