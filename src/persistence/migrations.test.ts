import assert from "node:assert/strict";
import test from "node:test";
import { MigrationRegistry, MigrationRunner } from "./migrations.js";
import type { MigrationRecord, MigrationStore } from "./contracts/index.js";

test("migration runner orders, records, skips, and rejects checksum conflicts", async () => {
  const records: MigrationRecord[] = [];
  const store: MigrationStore = { listApplied: async () => [...records], recordApplied: async (record) => { records.push(record); } };
  const calls: string[] = [];
  const registry = new MigrationRegistry();
  registry.register({ id: "002", checksum: "b", apply: () => { calls.push("002"); } });
  registry.register({ id: "001", checksum: "a", apply: () => { calls.push("001"); } });
  const runner = new MigrationRunner(store, () => "2026-08-20T00:00:00.000Z");
  assert.deepEqual(await runner.run(registry), ["001", "002"]);
  assert.deepEqual(calls, ["001", "002"]);
  assert.deepEqual(await runner.run(registry), []);
  const changed = new MigrationRegistry();
  changed.register({ id: "001", checksum: "changed", apply: () => undefined });
  await assert.rejects(runner.run(changed), /migration_checksum_conflict/);
});
