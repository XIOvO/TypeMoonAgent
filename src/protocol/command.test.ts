import assert from "node:assert/strict";
import test from "node:test";
import type { CommandEnvelope, CommandResult } from "./command.js";

test("command contracts return proposals without pretending they are committed events", () => {
  const command: CommandEnvelope<{ destination: string }> = {
    id: "command-1", sessionId: "session-1", type: "world.move", actorId: "mash",
    payload: { destination: "bridge" }, causation: { agentActionId: "agent-action-1" }, correlationId: "trace-1",
  };
  const result: CommandResult = {
    accepted: true, events: [{ type: "world.character.moved", payload: { destination: "bridge" } }],
  };

  assert.equal("sequence" in result.events![0]!, false);
  assert.deepEqual(JSON.parse(JSON.stringify(command)), command);
});

test("command rejections are structured without a fake successful proposal", () => {
  const result: CommandResult = { accepted: false, rejection: { code: "command.unsupported" } };
  assert.equal(result.rejection?.code, "command.unsupported");
});
