import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentProviderObservation,
} from "agent-game-runtime/sdk";
import {
  createRuleAgentProvider,
  ruleAgentProvider,
} from "./index.js";

function observation(
  mood: "calm" | "alert" = "calm",
  incomingType = "dialogue",
): AgentProviderObservation {
  return {
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
      type: incomingType,
      content: "What should we do?",
    },
    selfState: {
      id: "companion-1",
      locationId: "room-1",
      mood,
    },
    constraints: [],
  };
}

test("rule-agent completes a deterministic turn without model credentials", async () => {
  assert.equal(ruleAgentProvider.supports({
    characterId: "companion-1",
    agentProfile: "rule",
  }), true);
  assert.equal(ruleAgentProvider.supports({
    characterId: "companion-1",
    agentProfile: "pi",
  }), false);

  const first = await ruleAgentProvider.run(observation());
  const second = await ruleAgentProvider.run(observation());

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    id: "example.rule-agent:observation-1",
    sessionId: "session-1",
    actorId: "companion-1",
    observationId: "observation-1",
    utterance: "I understand. I will stay with the plan.",
    requests: [],
  });
});

test("rule-agent reacts only to visible observation fields and proposes no world writes", async () => {
  const action = await ruleAgentProvider.run(observation("alert", "combat"));
  assert.equal(action.utterance, "I am alert and ready.");
  assert.deepEqual(action.requests, []);
});

test("rule-agent selection is declarative and does not hard-code character IDs", async () => {
  const provider = createRuleAgentProvider({
    providerHint: "credential-free",
    requiredTags: ["companion"],
    utterance: "Ready.",
  });
  const binding = {
    agentProfile: "rule",
    providerHint: "credential-free",
    tags: ["companion"],
  };

  assert.equal(provider.supports({ characterId: "character-a", ...binding }), true);
  assert.equal(provider.supports({ characterId: "character-b", ...binding }), true);
  assert.equal(provider.supports({
    characterId: "character-c",
    agentProfile: "rule",
    providerHint: "credential-free",
    tags: ["guest"],
  }), false);
  assert.equal((await provider.run(observation())).utterance, "Ready.");
});
