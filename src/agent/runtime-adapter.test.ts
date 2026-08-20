import assert from "node:assert/strict";
import test from "node:test";
import { AgentRegistry } from "./registry.js";
import { RegistryAgentRunnerResolver } from "./binding.js";
import { RuleBasedAgentProvider } from "./rule-based-provider.js";
import { PiAgentProvider } from "../agents/pi-agent-provider.js";
import { GameRuntime } from "../core/runtime.js";
import type { AgentAction, GameState, Observation } from "../core/contracts.js";

const world = (): GameState => ({
  sessionId: "demo", revision: 0,
  characters: { player: { id: "player", locationId: "hall", mood: "calm" }, mash: { id: "mash", locationId: "hall", mood: "calm" } },
  locations: { hall: { id: "hall", exits: [] } },
});

test("Runtime selects Pi or Rule only by character binding configuration", async () => {
  const registry = new AgentRegistry();
  registry.register(new RuleBasedAgentProvider({ utterance: "Rule reply" }));
  registry.register(new PiAgentProvider({
    run: async (observation: Observation) => ({ id: "pi:1", sessionId: observation.sessionId, actorId: observation.recipientId, observationId: observation.id, utterance: "Pi reply", requests: [] } as AgentAction),
    runCombined: async () => { throw new Error("not_used"); },
  }));

  for (const [profile, expected] of [["rule", "Rule reply"], ["pi", "Pi reply"]] as const) {
    const runtime = new GameRuntime(world(), new RegistryAgentRunnerResolver(registry, { mash: { agentProfile: profile } }));
    const result = await runtime.handlePlayerAction({ id: `player:${profile}`, sessionId: "demo", actorId: "player", type: "dialogue", content: "Hello", targetIds: ["mash"] });
    assert.equal(result.events[1]?.payload.text, expected);
  }
});
