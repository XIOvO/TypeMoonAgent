import assert from "node:assert/strict";
import test from "node:test";
import { CifPatternPublisher } from "./pattern-publisher.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

test("only an approved L2 draft can publish versioned live state", () => {
  const repository = new SqliteCifRepository();
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: [], emotions: [], activeGoals: ["protect the player"], availability: "free", updatedAt: "2026-08-01T00:00:00.000Z" });
  repository.saveAppearanceFactors({ sessionId: "demo", characterId: "mash", activeGoals: ["protect the player"], responseWeights: {}, relationshipWeights: {}, availability: "free", updatedAt: "2026-08-01T00:00:00.000Z" });
  repository.savePatternDraft(draft());
  const publisher = new CifPatternPublisher(repository);
  assert.throws(() => publisher.publish("pattern-1"), /must_be_approved/);
  repository.setPatternDraftStatus("pattern-1", "approved", "2026-08-03T00:00:00.000Z");
  const published = publisher.publish("pattern-1", "2026-08-03T00:01:00.000Z");
  assert.equal(published.status, "published");
  assert.equal(repository.listInterpretiveModels("demo", "mash", 5)[0]?.content, "Mash cautiously trusts the player's promises.");
  assert.equal(repository.listEpistemicStates("demo", "mash", 5)[0]?.proposition, "The player usually returns after promising.");
  assert.deepEqual(repository.getRuntimeState("demo", "mash")?.activeGoals, ["stay available for the player", "protect the player"]);
  assert.deepEqual(repository.getAppearanceFactors("demo", "mash")?.activeGoals, ["stay available for the player", "protect the player"]);
  repository.close();
});

test("the latest published belief version is the only version exposed to context", () => {
  const repository = new SqliteCifRepository();
  repository.saveEpistemicState({ id: "old", sessionId: "demo", characterId: "mash", proposition: "The player returns.", status: "possible", confidence: 0.3, supportingEvidenceIds: [], opposingEvidenceIds: [], version: 1 });
  repository.saveEpistemicState({ id: "new", sessionId: "demo", characterId: "mash", proposition: "The player returns.", status: "likely", confidence: 0.7, supportingEvidenceIds: ["episode-1", "episode-2"], opposingEvidenceIds: [], version: 2 });
  assert.deepEqual(repository.listEpistemicStates("demo", "mash", 5).map((state) => state.id), ["new"]);
  repository.close();
});

function draft() {
  return { id: "pattern-1", sessionId: "demo", characterId: "mash", triggerEpisodeId: "episode-2", status: "pending_review" as const,
    proposal: { shouldPropose: true, characterId: "mash", sourceEpisodeIds: ["episode-1", "episode-2"], rationale: "Two scenes support a cautious update.", relationship: { targetId: "player", content: "Mash cautiously trusts the player's promises.", confidence: 0.7 }, belief: { proposition: "The player usually returns after promising.", status: "likely" as const, confidence: 0.7 }, recurringGoal: { content: "stay available for the player", confidence: 0.65 } }, validationErrors: [], generator: "test", createdAt: "2026-08-02T00:00:00.000Z" };
}
