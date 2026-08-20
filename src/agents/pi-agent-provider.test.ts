import assert from "node:assert/strict";
import test from "node:test";
import { PiAgentProvider } from "./pi-agent-provider.js";
import type { AgentAction, CombinedTurnProposal, Observation, RawPlayerInput } from "../core/contracts.js";

test("PiAgentProvider delegates execution while selecting by declarative binding", async () => {
  const result = { id: "agent:1" } as AgentAction;
  const combined = { character: result } as CombinedTurnProposal;
  let received: Observation | undefined;
  let combinedInput: RawPlayerInput | undefined;
  const provider = new PiAgentProvider({
    run: async (observation) => { received = observation; return result; },
    runCombined: async (_observation, input) => { combinedInput = input; return combined; },
  }, { providerHint: "safe-tools" });
  const observation = { id: "observation:1" } as Observation;
  const input = { id: "raw:1" } as RawPlayerInput;

  assert.equal(provider.id, "agent.pi");
  assert.equal(provider.supports({ characterId: "mash", agentProfile: "pi", providerHint: "safe-tools" }), true);
  assert.equal(provider.supports({ characterId: "mash", agentProfile: "pi", providerHint: "other" }), false);
  assert.equal(await provider.run(observation), result);
  assert.equal(received, observation);
  assert.equal(await provider.runCombined(observation, input), combined);
  assert.equal(combinedInput, input);
});
