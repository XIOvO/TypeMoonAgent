import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import { SqliteMigrationStore } from "./sqlite-migration-store.js";

test("SQLite MigrationStore records and reads checksum-backed migrations", async () => {
  const repository = new SqliteCifRepository();
  try {
    const store = new SqliteMigrationStore(repository);
    await store.recordApplied({ id: "900-test", checksum: "abc", appliedAt: "2026-08-20T00:00:00.000Z" });
    assert.deepEqual((await store.listApplied()).find((record) => record.id === "900-test"), { id: "900-test", checksum: "abc", appliedAt: "2026-08-20T00:00:00.000Z" });
  } finally { repository.close(); }
});
