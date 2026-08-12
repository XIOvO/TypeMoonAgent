import assert from "node:assert/strict";
import test from "node:test";
import type { CifDraftGenerator, CifInitializationBrief, CifInitializationDraft } from "./initializer.js";
import { CifDraftService } from "./draft-service.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

const brief: CifInitializationBrief = {
  request: {
    sessionId: "demo", characterId: "mash", displayName: "玛修", variantId: "fgo-early", storyPointId: "fuyuki:start",
    introduction: { locationId: "fuyuki", presentEntityIds: ["player"], reason: "story_trigger" },
    canonScope: { region: "CN", warId: 100, maxQuestId: 1000000 },
  },
  evidence: [{ chunkId: "chunk-1", scriptId: "script-1", chunkOrder: 1, excerpt: "玛修保护前辈。", matchedTerms: ["玛修"] }],
  gaps: [],
};

class StubGenerator implements CifDraftGenerator {
  public constructor(private readonly draft: CifInitializationDraft) {}
  public async generate(): Promise<CifInitializationDraft> { return this.draft; }
}

const validDraft = (): CifInitializationDraft => ({
  characterId: "mash", variantId: "fgo-early", storyPointId: "fuyuki:start",
  identity: [{ section: "values", content: "Protect the Master.", sourceChunkIds: ["chunk-1"], confidence: "medium" }],
  initialKnowledge: [], initialRelationships: [], initialRuntimeState: { mood: "alert", activeGoals: ["protect player"] }, reviewFlags: [],
});

test("CIF draft service stores valid drafts for review without publishing identity", async () => {
  const repository = new SqliteCifRepository();
  const record = await new CifDraftService(repository, new StubGenerator(validDraft()), "test-generator").create(brief);
  assert.equal(record.status, "draft");
  assert.equal(repository.listInitializationDrafts("demo", "mash").length, 1);
  assert.equal(repository.listIdentity("demo", "mash").length, 0);
  repository.setInitializationDraftStatus(record.id, "approved", "2026-08-12T00:00:01Z");
  assert.equal(repository.listInitializationDrafts("demo", "mash")[0]?.status, "approved");
  assert.equal(repository.listIdentity("demo", "mash").length, 0);
  repository.close();
});

test("CIF draft service marks unsupported claims invalid instead of publishing", async () => {
  const repository = new SqliteCifRepository();
  const invalid = validDraft();
  invalid.identity[0]!.sourceChunkIds = ["invented-chunk"];
  const record = await new CifDraftService(repository, new StubGenerator(invalid), "test-generator").create(brief);
  assert.equal(record.status, "invalid");
  assert.deepEqual(record.validationErrors, ["claim_references_unknown_source"]);
  assert.equal(repository.listIdentity("demo", "mash").length, 0);
  repository.close();
});
