import assert from "node:assert/strict";
import test from "node:test";
import { createTestRuntime } from "agent-game-runtime/sdk";
import type { CommandEnvelope } from "agent-game-runtime/sdk";
import {
  GREETING_SENT_EVENT,
  SIMPLE_GREETING_CAPABILITY,
  simpleGreetingPlugin,
} from "./index.js";
import type {
  GreetingCommandPayload,
  SimpleGreetingCapability,
} from "./index.js";

function command(payload: GreetingCommandPayload): CommandEnvelope<GreetingCommandPayload> {
  return {
    id: "command-1",
    sessionId: "session-1",
    type: "example.greeting.send",
    actorId: "player-1",
    payload,
    causation: { playerActionId: "action-1" },
    correlationId: "correlation-1",
  };
}

test("simple-greeting closes one command/proposed-event loop through the public SDK", async (t) => {
  const runtime = await createTestRuntime({
    plugins: [{
      plugin: simpleGreetingPlugin,
      config: { prefix: "Welcome" },
    }],
  });
  t.after(() => runtime.dispose());

  const greeting = runtime.getCapability<SimpleGreetingCapability>(SIMPLE_GREETING_CAPABILITY.id);
  const result = await greeting.execute(command({ name: "Mash" }));

  assert.deepEqual(result, {
    accepted: true,
    events: [{
      type: GREETING_SENT_EVENT.type,
      payload: {
        name: "Mash",
        message: "Welcome, Mash!",
      },
    }],
  });
  assert.deepEqual(simpleGreetingPlugin.manifest.ownsEvents, [{
    namespace: "example.greeting",
    versions: [1],
  }]);
  assert.deepEqual(runtime.logs(), [{
    pluginId: "example.simple-greeting",
    level: "info",
    message: "simple greeting ready",
    details: { capability: SIMPLE_GREETING_CAPABILITY.id },
  }]);
});

test("simple-greeting rejects an empty greeting target without proposing events", async (t) => {
  const runtime = await createTestRuntime({
    plugins: [{ plugin: simpleGreetingPlugin }],
  });
  t.after(() => runtime.dispose());

  const greeting = runtime.getCapability<SimpleGreetingCapability>(SIMPLE_GREETING_CAPABILITY.id);
  assert.deepEqual(await greeting.execute(command({ name: "   " })), {
    accepted: false,
    rejection: { code: "greeting.invalid_command" },
  });
});
