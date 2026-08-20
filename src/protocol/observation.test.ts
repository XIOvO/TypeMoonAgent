import assert from "node:assert/strict";
import test from "node:test";
import type { LegacyObservation, Observation } from "./observation.js";

test("v0.3 observations can omit optional context while retaining visibility constraints", () => {
  const observation: Observation = {
    id: "observation-1", sessionId: "session-1", recipientId: "agent-1",
    scene: { locationId: "hall", visibleEntityIds: ["player-1"] },
    constraints: { forbiddenActionTypes: ["world.admin"], maxTargets: 1 },
    contextRefs: [{ type: "memory", id: "memory-1", summary: "A guarded promise." }],
  };

  assert.deepEqual(JSON.parse(JSON.stringify(observation)), observation);
});

test("legacy observations remain readable without changing their fields", () => {
  const observation: LegacyObservation<{ id: string }> = {
    id: "observation-1", sessionId: "session-1", recipientId: "agent-1", triggerActionId: "action-1",
    scene: { id: "hall", visibleEntityIds: ["player-1"] },
    incomingAction: { actorId: "player-1", type: "dialogue", content: "Hello" },
    selfState: { id: "agent-1" }, constraints: ["Describe visible facts only."],
  };

  assert.equal(observation.scene.id, "hall");
  assert.deepEqual(observation.constraints, ["Describe visible facts only."]);
});
