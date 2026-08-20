import assert from "node:assert/strict";
import test from "node:test";
import type { CharacterContextProvider } from "../../cif/character-context-provider.js";
import type { CharacterIdentityProvider } from "../../cif/character-identity-provider.js";
import type { CharacterMemoryProvider } from "../../cif/character-memory-provider.js";
import type { EpistemicProvider } from "../../cif/epistemic-provider.js";
import type { InterpretiveModelProvider } from "../../cif/interpretive-model-provider.js";
import type { CharacterContext } from "../../cif/types.js";
import { CapabilityRegistry } from "../../platform/capability-registry.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import {
  CHARACTER_CIF_PLUGIN_ID,
  CHARACTER_CONTEXT_CAPABILITY,
  CHARACTER_EPISTEMIC_CAPABILITY,
  CHARACTER_IDENTITY_CAPABILITY,
  CHARACTER_INTERPRETATION_CAPABILITY,
  CHARACTER_MEMORY_CAPABILITY,
  createCharacterCifPlugin,
} from "./character-cif.js";

const context: CharacterContext = {
  characterId: "mash",
  identity: [],
  runtimeState: { sessionId: "demo", characterId: "mash", attention: [], emotions: [], activeGoals: [], updatedAt: "epoch" },
  evidence: [],
  memoryAtoms: [],
  episodeMemories: [],
  epistemicStates: [],
  interpretiveModels: [],
};

test("feature.character-cif registers all five read-only providers as resolvable capabilities", async () => {
  const providers = {
    context: { build: async () => context } satisfies CharacterContextProvider,
    memory: { recall: async () => ({ atoms: [], episodes: [] }) } satisfies CharacterMemoryProvider,
    identity: { getIdentity: async () => [] } satisfies CharacterIdentityProvider,
    epistemic: { getStates: async () => [] } satisfies EpistemicProvider,
    interpretation: { getModels: async () => [] } satisfies InterpretiveModelProvider,
  };
  const registry = new CapabilityRegistry();
  const platform = new CordisPlatformAdapter(registry);
  const running = await platform.mountV2({
    profileId: "character-cif",
    plugins: [{ plugin: createCharacterCifPlugin(providers) }],
  });

  assert.equal(await registry.resolve<CharacterContextProvider>({ id: CHARACTER_CONTEXT_CAPABILITY, version: "^1.0.0" }).build({ sessionId: "demo", characterId: "mash" }), context);
  assert.deepEqual(await registry.resolve<CharacterMemoryProvider>({ id: CHARACTER_MEMORY_CAPABILITY }).recall({ sessionId: "demo", characterId: "mash" }), { atoms: [], episodes: [] });
  assert.deepEqual(await registry.resolve<CharacterIdentityProvider>({ id: CHARACTER_IDENTITY_CAPABILITY }).getIdentity({ sessionId: "demo", characterId: "mash" }), []);
  assert.deepEqual(await registry.resolve<EpistemicProvider>({ id: CHARACTER_EPISTEMIC_CAPABILITY }).getStates({ sessionId: "demo", characterId: "mash" }), []);
  assert.deepEqual(await registry.resolve<InterpretiveModelProvider>({ id: CHARACTER_INTERPRETATION_CAPABILITY }).getModels({ sessionId: "demo", characterId: "mash" }), []);
  assert.deepEqual(registry.list().map(({ id, pluginId }) => ({ id, pluginId })), [
    { id: CHARACTER_CONTEXT_CAPABILITY, pluginId: CHARACTER_CIF_PLUGIN_ID },
    { id: CHARACTER_MEMORY_CAPABILITY, pluginId: CHARACTER_CIF_PLUGIN_ID },
    { id: CHARACTER_IDENTITY_CAPABILITY, pluginId: CHARACTER_CIF_PLUGIN_ID },
    { id: CHARACTER_EPISTEMIC_CAPABILITY, pluginId: CHARACTER_CIF_PLUGIN_ID },
    { id: CHARACTER_INTERPRETATION_CAPABILITY, pluginId: CHARACTER_CIF_PLUGIN_ID },
  ]);

  await running.dispose();
  assert.equal(registry.has({ id: CHARACTER_CONTEXT_CAPABILITY }), false);
  assert.equal(registry.has({ id: CHARACTER_MEMORY_CAPABILITY }), false);
  assert.equal(registry.has({ id: CHARACTER_IDENTITY_CAPABILITY }), false);
  assert.equal(registry.has({ id: CHARACTER_EPISTEMIC_CAPABILITY }), false);
  assert.equal(registry.has({ id: CHARACTER_INTERPRETATION_CAPABILITY }), false);
});
