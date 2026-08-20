import assert from "node:assert/strict";
import test from "node:test";
import { BuilderCharacterContextProvider } from "./character-context-provider.js";
import type { CharacterContext } from "./types.js";

const context = (): CharacterContext => ({
  characterId: "mash", identity: [], runtimeState: { sessionId: "demo", characterId: "mash", attention: [], emotions: [], activeGoals: [], updatedAt: "epoch" },
  evidence: [{ id: "e1" }, { id: "e2" }] as never, memoryAtoms: [{ id: "a1" }, { id: "a2" }] as never,
  episodeMemories: [{ id: "m1" }, { id: "m2" }] as never, epistemicStates: [], interpretiveModels: [],
  objectiveRelationships: [{ id: "r1" }, { id: "r2" }] as never,
});

test("CharacterContextProvider maps read-only budgets and rejects undefined token budgeting", async () => {
  let options: unknown;
  const provider = new BuilderCharacterContextProvider({ build: (_sessionId, _characterId, input) => {
    options = input;
    const built = context();
    return { ...built, evidence: built.evidence.slice(0, input?.evidenceLimit) };
  } });
  const result = await provider.build({ sessionId: "demo", characterId: "mash", participantIds: ["player"], budget: { maxEvidenceItems: 1, maxMemoryItems: 3, maxRelationshipItems: 1 } });

  assert.equal((options as { evidenceLimit?: number }).evidenceLimit, 1);
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(result.memoryAtoms.map(({ id }) => id), ["a1", "a2"]);
  assert.deepEqual(result.episodeMemories.map(({ id }) => id), ["m1"]);
  assert.deepEqual(result.objectiveRelationships?.map(({ id }) => id), ["r1"]);
  await assert.rejects(provider.build({ sessionId: "demo", characterId: "mash", budget: { maxEstimatedTokens: 100 } }), /character_context_token_budget_unsupported/);
  await assert.rejects(provider.build({ sessionId: "demo", characterId: "mash", budget: { maxMemoryItems: -1 } }), /character_context_budget_invalid/);
});
