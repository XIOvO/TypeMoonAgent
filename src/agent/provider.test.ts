import assert from "node:assert/strict";
import test from "node:test";
import type { AgentAction, Observation } from "../core/contracts.js";
import type { AgentProvider, BindingQuery } from "./provider.js";

test("AgentProvider can be independently mocked from model SDKs", async () => {
  const query: BindingQuery = { characterId: "mash", agentProfile: "rule", tags: ["companion"], providerHint: "deterministic" };
  const provider: AgentProvider = {
    id: "test.rule",
    supports: (candidate) => candidate.agentProfile === "rule",
    run: async () => ({ id: "agent:1", sessionId: "demo", actorId: "mash", observationId: "observation:1", requests: [] } as AgentAction),
  };
  assert.equal(provider.supports(query), true);
  assert.equal((await provider.run({} as Observation)).id, "agent:1");
});
