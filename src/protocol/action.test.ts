import assert from "node:assert/strict";
import test from "node:test";
import type { ActionResult, ParsedPlayerIntent, PlayerAction, RawPlayerInput } from "./action.js";

test("action protocol preserves the three v0.2 lanes and auto interpreter boundary", () => {
  const input: RawPlayerInput = {
    id: "input-1", sessionId: "session-1", actorId: "player-1", content: "look around", mode: "auto",
  };
  const parsed: ParsedPlayerIntent = { kind: "needs_interpreter", reason: "ambiguous_freeform_input" };
  const action: PlayerAction = { ...input, type: "action" };

  assert.equal(input.mode, "auto");
  assert.equal(parsed.kind, "needs_interpreter");
  assert.equal(action.type, "action");
});

test("action results stay serializable without a Runtime event dependency", () => {
  const result: ActionResult<{ id: string }> = {
    actionId: "action-1", events: [{ id: "event-1" }], stateRevision: 2,
  };

  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});
