import assert from "node:assert/strict";
import test from "node:test";
import {
  COMBAT_RESOLVE_CAPABILITY,
  runAgentProviderConformance,
  runPluginConformance,
} from "agent-game-runtime/sdk";
import type {
  AgentProviderObservation,
  CommandEnvelope,
} from "agent-game-runtime/sdk";
import {
  SIMPLE_GREETING_CAPABILITY,
  simpleGreetingPlugin,
} from "../plugins/simple-greeting/index.js";
import type { SimpleGreetingCapability } from "../plugins/simple-greeting/index.js";
import {
  simpleCombatPlugin,
} from "../plugins/simple-combat/index.js";
import type { CombatResolveCapability } from "../plugins/simple-combat/index.js";
import {
  combatCommand,
} from "../plugins/simple-combat/conformance.js";
import {
  ruleAgentProvider,
} from "../providers/rule-agent/index.js";

test("simple-greeting passes the public plugin conformance suite", async () => {
  const report = await runPluginConformance({
    plugin: simpleGreetingPlugin,
    config: { prefix: "Hello" },
    probes: [{
      name: "greeting-command",
      async run(runtime) {
        const greeting = runtime.getCapability<SimpleGreetingCapability>(SIMPLE_GREETING_CAPABILITY.id);
        const command: CommandEnvelope<{ name: string }> = {
          id: "greeting-1",
          sessionId: "session-1",
          type: "example.greeting.send",
          actorId: "player-1",
          payload: { name: "Mash" },
          causation: {},
          correlationId: "greeting-conformance",
        };
        const result = await greeting.execute(command);
        assert.equal(result.accepted, true);
        assert.equal(result.events?.[0]?.type, "example.greeting.sent");
      },
    }],
  });

  assert.equal(report.passed, true, JSON.stringify(report.checks));
});

test("simple-combat passes the public plugin conformance suite", async () => {
  const report = await runPluginConformance({
    plugin: simpleCombatPlugin,
    config: { attackDamage: 2 },
    probes: [{
      name: "combat-command",
      async run(runtime) {
        const combat = runtime.getCapability<CombatResolveCapability>(COMBAT_RESOLVE_CAPABILITY);
        const result = await combat.execute(combatCommand({
          participation: "command",
          commands: [{ intent: "attack", targetId: "enemy-1" }],
        }));
        assert.equal(result.accepted, true);
        assert.equal(result.events?.[0]?.type, "combat.action.resolved");
        assert.equal((result.events?.[0]?.payload as { damage?: number }).damage, 2);
      },
    }],
  });

  assert.equal(report.passed, true, JSON.stringify(report.checks));
});

test("rule-agent passes the public agent provider conformance suite", async () => {
  const observation: AgentProviderObservation = {
    id: "observation-1",
    sessionId: "session-1",
    recipientId: "companion-1",
    triggerActionId: "action-1",
    scene: {
      id: "room-1",
      visibleEntityIds: ["player-1", "companion-1"],
    },
    incomingAction: {
      actorId: "player-1",
      type: "dialogue",
      content: "Ready?",
    },
    selfState: {
      id: "companion-1",
      locationId: "room-1",
      mood: "calm",
    },
    constraints: [],
  };
  const report = await runAgentProviderConformance({
    provider: ruleAgentProvider,
    matchingQuery: {
      characterId: "companion-1",
      agentProfile: "rule",
    },
    nonMatchingQuery: {
      characterId: "companion-1",
      agentProfile: "pi",
    },
    observation,
    verifyAction(action) {
      assert.deepEqual(action.requests, []);
    },
  });

  assert.equal(report.passed, true, JSON.stringify(report.checks));
});
