import assert from "node:assert/strict";
import test from "node:test";
import { STORY_ENTER_CAPABILITY, STORY_PROGRESS_CAPABILITY } from "../protocol/story-commands.js";
import { StoryCommandDispatcher } from "./command-dispatcher.js";

const command = (type: string, payload: object) => ({ id: "story-command", sessionId: "demo", type, payload, causation: {}, correlationId: "trace-story" });

test("Story dispatcher stably rejects a command whose capability is not registered", async () => {
  const result = await new StoryCommandDispatcher().execute(command(STORY_ENTER_CAPABILITY, { playerId: "player", packageId: "fuyuki", mode: "new" }));
  assert.deepEqual(result, { accepted: false, rejection: { code: "story.capability_unavailable", details: { capability: STORY_ENTER_CAPABILITY } } });
});

test("Story dispatcher delegates only a registered command capability", async () => {
  const dispatcher = new StoryCommandDispatcher({ [STORY_PROGRESS_CAPABILITY]: (input) => ({ accepted: true, events: [{ type: "story.progress.proposed", payload: input.payload }] }) });
  assert.equal((await dispatcher.execute(command(STORY_PROGRESS_CAPABILITY, { playerId: "player", packageId: "fuyuki", nodeId: "arrival", sourceEventIds: ["event-1"] }))).accepted, true);
  assert.equal((await dispatcher.execute(command(STORY_ENTER_CAPABILITY, { playerId: "player", packageId: "fuyuki", mode: "new" }))).rejection?.code, "story.capability_unavailable");
});
