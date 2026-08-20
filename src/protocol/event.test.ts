import assert from "node:assert/strict";
import test from "node:test";
import { upgradeLegacyGameEvent } from "./event.js";

test("legacy event upgrades without changing its payload, ordering, or revision", () => {
  const legacy = {
    id: "event-1", sessionId: "session-1", createdAt: "2026-08-20T00:00:00.000Z", sequence: 8,
    type: "character_moved", payload: { destination: "bridge" }, causation: { systemActionId: "system-1" }, stateRevision: 5,
  };
  const upgraded = upgradeLegacyGameEvent(legacy);

  assert.equal(upgraded.schemaVersion, 3);
  assert.equal(upgraded.sequence, legacy.sequence);
  assert.equal(upgraded.stateRevision, legacy.stateRevision);
  assert.deepEqual(upgraded.payload, legacy.payload);
  assert.deepEqual(upgraded.causation, { commandId: "system-1" });
  assert.equal(upgraded.source.system, "legacy-v0.2");
});
