import assert from "node:assert/strict";
import test from "node:test";
import { buildCifPiPrompt } from "./pi-prompt.js";

test("Pi prompt keeps current facts separate from subjective CIF context", () => {
  const prompt = JSON.parse(buildCifPiPrompt(
    { id: "ob", sessionId: "s", recipientId: "mash", triggerActionId: "p", scene: { id: "hall", visibleEntityIds: ["mash", "player"] }, incomingAction: { actorId: "player", type: "dialogue", content: "Are you all right?" }, selfState: { id: "mash", locationId: "hall", mood: "calm" }, constraints: [] },
    { characterId: "mash", identity: [{ id: "i", sessionId: "s", characterId: "mash", section: "values", content: "Protect others.", sourceIds: [], version: 1 }], runtimeState: { sessionId: "s", characterId: "mash", attention: [], emotions: [], activeGoals: [], updatedAt: "2026-01-01" }, evidence: [], memoryAtoms: [], episodeMemories: [], epistemicStates: [{ id: "e", sessionId: "s", characterId: "mash", proposition: "The player is safe.", status: "uncertain", confidence: 0.3, supportingEvidenceIds: [], opposingEvidenceIds: [], version: 1 }], interpretiveModels: [] },
  ));
  assert.equal(prompt.observation.scene.id, "hall");
  assert.equal(prompt.cifContext.identity[0].content, "Protect others.");
  assert.equal(prompt.cifContext.epistemicStates[0].status, "uncertain");
});
