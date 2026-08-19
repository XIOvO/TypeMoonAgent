import assert from "node:assert/strict";
import test from "node:test";
import { CharacterContextBuilder, CORE_IDENTITY_SECTIONS } from "./context-builder.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

test("CIF context keeps evidence, belief, identity, and objective history separate", () => {
  const repository = new SqliteCifRepository();
  repository.appendObjectiveHistory({ id: "event-1", sessionId: "demo", sequence: 1, eventType: "player_arrived", payload: { location: "station" }, createdAt: "2026-08-11T10:00:00Z" });
  repository.saveIdentity({ id: "identity-1", sessionId: "demo", characterId: "mash", section: "values", content: "Protect the Master while respecting their choices.", sourceIds: ["canon-1"], version: 1 });
  repository.saveIdentity({ id: "identity-2", sessionId: "demo", characterId: "mash", section: "voice_embodiment", content: "Measured, respectful speech.", sourceIds: ["canon-1"], version: 1 });
  repository.saveIdentity({ id: "identity-3", sessionId: "demo", characterId: "mash", section: "dream", content: "A peaceful future.", sourceIds: ["canon-1"], version: 1 });
  repository.saveIdentity({ id: "identity-4", sessionId: "demo", characterId: "mash", section: "growth_boundaries", content: "Change only through sustained evidence.", sourceIds: ["canon-1"], version: 1 });
  repository.saveProfile({ sessionId: "demo", characterId: "mash", variantId: "fgo-early", storyPointId: "fuyuki:start", displayName: "玛修", aliases: ["Mash"], socialIdentity: "Demi-Servant", sourceIds: ["canon-1"], version: 1 });
  repository.saveCapability({ id: "capability-1", sessionId: "demo", characterId: "mash", category: "limitation", content: "Cannot leave the mission without authorization.", mechanicalTags: ["restricted"], sourceIds: ["canon-1"], version: 1 });
  repository.saveLifeContext({ sessionId: "demo", characterId: "mash", responsibilities: ["protect player"], sourceIds: ["canon-1"], version: 1 });
  repository.saveObjectiveRelationship({ id: "objective-relation-1", sessionId: "demo", characterId: "mash", targetId: "player", relationType: "mission_partner", sourceIds: ["canon-1"], version: 1 });
  repository.saveEvidence({ id: "evidence-1", sessionId: "demo", characterId: "mash", kind: "observation", content: "The player arrived late and looked exhausted.", sourceEventIds: ["event-1"], sourceType: "world_event", sourceTrust: 0.9, verifiedStatus: "verified", sensoryImpression: "pale and unsteady", recallCues: ["late arrival"], reliability: 0.9, importance: 0.8, occurredAt: "2026-08-11T10:00:00Z" });
  repository.saveEpistemicState({ id: "epistemic-1", sessionId: "demo", characterId: "mash", proposition: "The player arrived late.", status: "accepted", confidence: 0.98, supportingEvidenceIds: ["evidence-1"], opposingEvidenceIds: [], version: 1 });
  repository.saveInterpretiveModel({ id: "belief-1", sessionId: "demo", characterId: "mash", kind: "belief", content: "A late arrival may have a serious reason; confirm safety before blaming.", activation: 0.7, supportingEvidenceIds: ["evidence-1"], opposingEvidenceIds: [], scope: "player safety", stability: "moderate", exceptions: ["immediate danger"], changeConditions: ["repeated contrary evidence"], version: 1 });
  repository.saveInterpretiveModel({ id: "social-1", sessionId: "demo", characterId: "mash", kind: "social", targetId: "outsider", content: "Unrelated outsider model.", activation: 1, supportingEvidenceIds: [], opposingEvidenceIds: [], version: 1 });
  repository.saveRuntimeState({ sessionId: "demo", characterId: "mash", attention: ["player"], emotions: [{ type: "concern", intensity: 0.6, targetId: "player" }], activeGoals: ["confirm_player_safety"], locationId: "station", availability: "free", currentIntention: "check the player's condition", expressionStrategy: "gentle_directness", updatedAt: "2026-08-11T10:00:00Z" });

  const context = new CharacterContextBuilder(repository).build("demo", "mash", { participantIds: ["player"], additionalIdentitySections: ["dream"] });
  assert.equal(context.identity.some((item) => item.section === "values"), true);
  assert.ok(CORE_IDENTITY_SECTIONS.includes("voice_embodiment"));
  assert.deepEqual(context.identity.map((item) => item.section), ["dream", "values", "voice_embodiment"]);
  assert.equal(context.evidence[0]?.content, "The player arrived late and looked exhausted.");
  assert.equal(context.evidence[0]?.verifiedStatus, "verified");
  assert.equal(context.epistemicStates[0]?.status, "accepted");
  assert.equal(context.interpretiveModels[0]?.kind, "belief");
  assert.equal(context.interpretiveModels.some((item) => item.targetId === "outsider"), false);
  assert.deepEqual(context.interpretiveModels[0]?.exceptions, ["immediate danger"]);
  assert.equal(context.runtimeState.activeGoals[0], "confirm_player_safety");
  assert.equal(context.runtimeState.currentIntention, "check the player's condition");
  assert.equal(context.capabilities?.[0]?.category, "limitation");
  assert.equal(context.objectiveRelationships?.[0]?.targetId, "player");
  assert.equal(repository.getProfile("demo", "mash")?.displayName, "玛修");
  assert.equal(repository.listCapabilities("demo", "mash")[0]?.category, "limitation");
  assert.equal(repository.getLifeContext("demo", "mash")?.responsibilities?.[0], "protect player");
  assert.equal(repository.listObjectiveRelationships("demo", "mash")[0]?.relationType, "mission_partner");
  repository.close();
});

test("confirmed major-event evidence expands CIF context without changing identity", () => {
  const repository = new SqliteCifRepository();
  repository.saveIdentity({ id: "brief", sessionId: "demo", characterId: "mash", section: "character_brief", content: "A protector.", sourceIds: [], version: 1 });
  repository.saveIdentity({ id: "growth", sessionId: "demo", characterId: "mash", section: "growth_boundaries", content: "Requires sustained evidence.", sourceIds: [], version: 1 });
  repository.saveEvidence({ id: "battle", sessionId: "demo", characterId: "mash", kind: "observation", content: "Battle ended.", sourceEventIds: ["event-1"], sourceType: "world_event", verifiedStatus: "verified", recallCues: ["battle_aftermath", "major_confirmed"], reliability: 1, importance: 0.9, occurredAt: "2026-08-14T00:00:00Z" });
  const context = new CharacterContextBuilder(repository).build("demo", "mash");
  assert.equal(context.identity.some((item) => item.section === "growth_boundaries"), true);
  assert.equal(context.evidence[0]?.recallCues?.includes("major_confirmed"), true);
  repository.close();
});
