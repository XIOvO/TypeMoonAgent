import assert from "node:assert/strict";
import test from "node:test";
import { createBindingQuery, type CharacterAgentBinding } from "./binding.js";
import { AgentRegistry } from "./registry.js";
import type { AgentProvider } from "./provider.js";

const provider = (id: string, profile: string): AgentProvider => ({
  id,
  supports: (query) => query.agentProfile === profile,
  run: async () => ({}) as never,
});

test("character binding configuration selects providers without character-ID rules", () => {
  const registry = new AgentRegistry();
  const rule = provider("agent.rule", "rule");
  const pi = provider("agent.pi", "pi");
  registry.register(rule);
  registry.register(pi);

  const bindings: Record<string, CharacterAgentBinding> = {
    mash: { agentProfile: "rule", tags: ["companion"], providerHint: "deterministic" },
    da_vinci: { agentProfile: "pi", tags: ["advisor"], providerHint: "safe-tools" },
  };

  assert.equal(registry.resolve(createBindingQuery("mash", bindings.mash)), rule);
  assert.equal(registry.resolve(createBindingQuery("da_vinci", bindings.da_vinci)), pi);
  assert.deepEqual(createBindingQuery("mash", bindings.mash), {
    characterId: "mash", agentProfile: "rule", tags: ["companion"], providerHint: "deterministic",
  });
});
