import assert from "node:assert/strict";
import test from "node:test";
import { adaptLegacyActionRequest } from "./agent-action.js";

test("agent request adapter accepts a compatible move proposal", () => {
  assert.deepEqual(adaptLegacyActionRequest({ type: "move", actorId: "mash", parameters: { destination: "bridge" } }), {
    accepted: true, request: { type: "move", actorId: "mash", destination: "bridge" },
  });
});

test("agent request adapter rejects unknown or malformed proposals", () => {
  assert.deepEqual(adaptLegacyActionRequest({ type: "world.teleport", actorId: "mash" }), {
    accepted: false, reason: "unsupported_action_request",
  });
  assert.deepEqual(adaptLegacyActionRequest({ type: "move", actorId: "mash" }), {
    accepted: false, reason: "invalid_move_request",
  });
});
