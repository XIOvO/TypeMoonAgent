import assert from "node:assert/strict";
import test from "node:test";
import type { CifInitializationDraftRecord } from "./initializer.js";
import { CifInitializationPublisher } from "./publisher.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

const approved = (): CifInitializationDraftRecord => ({
  id: "draft-1", status: "approved", generator: "test", createdAt: "2026-08-12T00:00:00Z", validationErrors: [],
  brief: {
    request: {
      sessionId: "demo", characterId: "mash", displayName: "玛修", variantId: "fgo-early", storyPointId: "fuyuki:start",
      introduction: { locationId: "fuyuki", presentEntityIds: ["player"], reason: "story_trigger" }, canonScope: { region: "CN", warId: 100 },
    }, evidence: [{ chunkId: "chunk-1", scriptId: "script-1", chunkOrder: 1, excerpt: "玛修保护前辈。", matchedTerms: ["玛修"] }], gaps: [],
  },
  draft: {
    characterId: "mash", variantId: "fgo-early", storyPointId: "fuyuki:start",
    identity: [{ section: "values", content: "Protect the Master.", sourceChunkIds: ["chunk-1"], confidence: "high" }],
    initialKnowledge: [{ proposition: "The player is present.", sourceChunkIds: ["chunk-1"], confidence: "medium" }],
    initialRelationships: [{ targetId: "player", summary: "A person to protect.", sourceChunkIds: ["chunk-1"], confidence: "medium" }],
    initialRuntimeState: { mood: "alert", activeGoals: ["protect player"] }, reviewFlags: [],
  },
});

test("publisher only turns an approved, validated draft into live CIF state", () => {
  const repository = new SqliteCifRepository();
  const record = approved();
  repository.saveInitializationDraft(record);
  new CifInitializationPublisher(repository).publish(record, "2026-08-12T00:01:00Z");
  assert.equal(repository.listIdentity("demo", "mash").length, 1);
  assert.equal(repository.listEpistemicStates("demo", "mash", 5).length, 1);
  assert.equal(repository.listInterpretiveModels("demo", "mash", 5).length, 1);
  assert.deepEqual(repository.getRuntimeState("demo", "mash")?.activeGoals, ["protect player"]);
  assert.deepEqual(repository.getAppearanceFactors("demo", "mash"), {
    sessionId: "demo", characterId: "mash", activeGoals: ["protect player"],
    responseWeights: {}, relationshipWeights: {}, availability: "free", updatedAt: "2026-08-12T00:01:00Z",
  });
  assert.equal(repository.countObjectiveHistory("demo"), 1);
  assert.equal(repository.listInitializationDrafts("demo", "mash")[0]?.status, "published");
  repository.close();
});

test("publisher checks the stored approval state rather than trusting the caller", () => {
  const repository = new SqliteCifRepository();
  const record = approved();
  record.status = "draft";
  repository.saveInitializationDraft(record);
  record.status = "approved";
  assert.throws(() => new CifInitializationPublisher(repository).publish(record), /draft_must_be_approved/);
  assert.equal(repository.listIdentity("demo", "mash").length, 0);
  repository.close();
});

test("publisher refuses a draft that has not been approved", () => {
  const repository = new SqliteCifRepository();
  const record = approved();
  record.status = "draft";
  assert.throws(() => new CifInitializationPublisher(repository).publish(record), /draft_must_be_approved/);
  assert.equal(repository.listIdentity("demo", "mash").length, 0);
  repository.close();
});
