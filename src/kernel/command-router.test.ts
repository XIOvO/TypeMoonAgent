import assert from "node:assert/strict";
import test from "node:test";
import { CommandRouter } from "./command-router.js";

const command = { id: "command-1", sessionId: "session-1", type: "world.move", payload: {}, causation: {}, correlationId: "trace-1" };

test("command router dispatches a registered command once", async () => {
  const router = new CommandRouter();
  router.register("world.move", () => ({ accepted: true }));
  assert.deepEqual(await router.execute(command), { accepted: true });
  assert.throws(() => router.register("world.move", () => ({ accepted: true })), /command_handler_already_registered/);
});

test("command router returns a stable rejection for an unregistered command", async () => {
  const result = await new CommandRouter().execute(command);
  assert.deepEqual(result, { accepted: false, rejection: { code: "command.not_found", details: { type: "world.move" } } });
});
