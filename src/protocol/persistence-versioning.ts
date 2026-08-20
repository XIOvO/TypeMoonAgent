/** Current storage-row format for events, snapshots, and durable jobs. */
export const CURRENT_PERSISTENCE_SCHEMA_VERSION = 1;

export interface VersionedRecord<T> {
  schemaVersion: number;
  value: T;
}

/** Old rows without a version are v0; their payload is preserved in memory. */
export function upgradePersistedRecord<T>(value: T, schemaVersion?: number): VersionedRecord<T> {
  const sourceVersion = schemaVersion ?? 0;
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 0 || sourceVersion > CURRENT_PERSISTENCE_SCHEMA_VERSION) {
    throw new Error("persistence_schema_version_unsupported");
  }
  return { schemaVersion: CURRENT_PERSISTENCE_SCHEMA_VERSION, value };
}
