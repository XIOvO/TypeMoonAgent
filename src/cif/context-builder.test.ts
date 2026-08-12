import assert from "node:assert/strict";
import test from "node:test";
import { CharacterContextBuilder } from "./context-builder.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

test("CIF context keeps evidence, belief, identity, and objective history separate", () => {
  const repository = new SqliteCifRepository();
  repository.appendObjectiveHistory({ id: "event-1", sessionId: "demo", sequence: 1, eventType: "player_arrived", payload: { location: "station" }, createdAt: "2026-08-11T10:00:00Z" });
  repository.saveIdentity({ id: "identity-1", sessionId: "demo", characterId: "mash", section: "values", content: "Protect the Master while respecting their choices.", sourceIds: ["canon-1"], version: 1 });
  repository.saveEvidence({ id: "evidence-1", sessionId: "demo", characterId: "mash", kind: "observation", content: "The player arrived late and looked exhausted.", sourceEventIds: ["event-1"], reliability: 0.9, importance: 0.8, occurredAt: "2026-08-11T10:00:00Z" });
  repository.saveEpistemicState({ id: "epistemic-1", sessionId: "demo", characterId: "mash", proposition: "The player arrived late.", status: "accepted", confidence: 0.98, supportingEvidenceIds: ["evidence-1"], opposingEvidenceIds: [], version: 1 });
  repository.saveInterpretiveModel({ id: "belief-1", sessionId: "demo", characterId: "mash", kind: "belief", content: "A late arrival may have a serious reason; confirm safety before blaming.", activation: 0.7, supportingEvidenceIds: ["evidence-1"], opposingEvidenceIds: [], version: 1 });
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: ["player"], emotions: [{ type: "concern", intensity: 0.6, targetId: "player" }], activeGoals: ["confirm_player_safety"], expressionStrategy: "gentle_directness", updatedAt: "2026-08-11T10:00:00Z" });

  const context = new CharacterContextBuilder(repository).build("demo", "mash");
  assert.equal(context.identity[0]?.section, "values");
  assert.equal(context.evidence[0]?.content, "The player arrived late and looked exhausted.");
  assert.equal(context.epistemicStates[0]?.status, "accepted");
  assert.equal(context.interpretiveModels[0]?.kind, "belief");
  assert.equal(context.runtimeState.activeGoals[0], "confirm_player_safety");
  repository.close();
});
