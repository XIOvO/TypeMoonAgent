import assert from "node:assert/strict";
import test from "node:test";
import { AgentRegistry } from "./registry.js";
import type { AgentProvider } from "./provider.js";

const provider = (id: string, profile: string): AgentProvider => ({ id, supports: (query) => query.agentProfile === profile, run: async () => ({}) as never });

test("AgentRegistry registers, resolves, unregisters, and rejects missing providers", () => {
  const registry = new AgentRegistry();
  const rule = provider("rule", "rule");
  registry.register(rule);
  assert.equal(registry.resolve({ characterId: "mash", agentProfile: "rule" }), rule);
  assert.throws(() => registry.register(rule), /agent_provider_duplicate/);
  registry.unregister("rule");
  assert.throws(() => registry.resolve({ characterId: "mash", agentProfile: "rule" }), /agent_provider_not_found/);
});
