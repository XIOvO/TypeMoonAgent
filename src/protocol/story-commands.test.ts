import assert from "node:assert/strict";
import test from "node:test";
import { STORY_COMMAND_SCHEMAS, STORY_ENTER_CAPABILITY, STORY_EVALUATE_CAPABILITY, STORY_PROGRESS_CAPABILITY, isStoryCommand } from "./story-commands.js";

test("Story command schemas are serializable and accept only their minimum payloads", () => {
  assert.deepEqual(Object.keys(STORY_COMMAND_SCHEMAS), [STORY_ENTER_CAPABILITY, STORY_EVALUATE_CAPABILITY, STORY_PROGRESS_CAPABILITY]);
  assert.equal(isStoryCommand(command(STORY_ENTER_CAPABILITY, { playerId: "player", packageId: "fuyuki", mode: "new" })), true);
  assert.equal(isStoryCommand(command(STORY_EVALUATE_CAPABILITY, { packageId: "fuyuki", eventIds: ["event-1"] })), true);
  assert.equal(isStoryCommand(command(STORY_PROGRESS_CAPABILITY, { playerId: "player", packageId: "fuyuki", nodeId: "arrival", sourceEventIds: ["event-1"] })), true);
  assert.equal(isStoryCommand(command(STORY_PROGRESS_CAPABILITY, { playerId: "player", packageId: "fuyuki", nodeId: "arrival", sourceEventIds: [] })), false);
  assert.equal(isStoryCommand(command(STORY_ENTER_CAPABILITY, { playerId: "player", packageId: "fuyuki", mode: "new", unexpected: true })), false);
  assert.equal(JSON.parse(JSON.stringify(STORY_COMMAND_SCHEMAS))[STORY_ENTER_CAPABILITY].required.includes("packageId"), true);
});

function command(type: string, payload: object) { return { id: "command-1", sessionId: "demo", type, payload, causation: {}, correlationId: "trace-1" }; }
