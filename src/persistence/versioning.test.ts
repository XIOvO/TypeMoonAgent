import assert from "node:assert/strict";
import test from "node:test";
import { CURRENT_PERSISTENCE_SCHEMA_VERSION, upgradePersistedRecord } from "./versioning.js";

test("persistence versioning reads legacy rows and writes the current version in memory", () => {
  const payload = { id: "legacy" };
  assert.deepEqual(upgradePersistedRecord(payload), { schemaVersion: CURRENT_PERSISTENCE_SCHEMA_VERSION, value: payload });
  assert.deepEqual(upgradePersistedRecord(payload, CURRENT_PERSISTENCE_SCHEMA_VERSION), { schemaVersion: CURRENT_PERSISTENCE_SCHEMA_VERSION, value: payload });
  assert.throws(() => upgradePersistedRecord(payload, 99), /persistence_schema_version_unsupported/);
});
