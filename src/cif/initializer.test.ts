import assert from "node:assert/strict";
import test from "node:test";
import { SqliteLoreRepository } from "../lore/sqlite-repository.js";
import { buildCifInitializationPrompt, CifInitializer, validateCifInitializationDraft } from "./initializer.js";

test("CIF initializer retrieves only in-scope canon evidence and requires citations", () => {
  const lore = new SqliteLoreRepository();
  const add = (id: string, questId: number, text: string) => lore.replaceDocument({
    id, source: "atlas", region: "CN", scriptId: id.slice(-1), warId: 100, questId, questName: "冬木", phase: 1,
    sourceUrl: "https://example.test", localPath: "script.txt", contentSha1: id, byteSize: text.length, fetchedAt: "2026-08-12T00:00:00Z",
  }, [{ id: `${id}:chunk:0001`, documentId: id, chunkOrder: 1, text, speakerNames: ["玛修"] }]);
  add("atlas:CN:script:early", 1000000, "玛修提醒前辈不要离开她身边。");
  add("atlas:CN:script:future", 1000010, "玛修在未来事件中得知了不应提前知道的事实。");
  const initializer = new CifInitializer(lore);
  const brief = initializer.buildBrief({
    sessionId: "demo", characterId: "mash", displayName: "玛修", variantId: "fgo-early", storyPointId: "fuyuki:start",
    introduction: { locationId: "fuyuki", presentEntityIds: ["player"], reason: "story_trigger" },
    canonScope: { region: "CN", warId: 100, maxQuestId: 1000000 },
  });
  assert.equal(brief.evidence.length, 1);
  assert.match(brief.evidence[0]?.excerpt ?? "", /不要离开/);
  assert.match(buildCifInitializationPrompt(brief), /Do not invent/);
  assert.deepEqual(validateCifInitializationDraft(brief, {
    characterId: "mash", variantId: "fgo-early", storyPointId: "fuyuki:start",
    identity: [{ section: "values", content: "protective", sourceChunkIds: [brief.evidence[0]!.chunkId], confidence: "medium" }],
    initialKnowledge: [], initialRelationships: [], initialRuntimeState: { mood: "alert", activeGoals: ["protect player"] }, reviewFlags: [],
  }), []);
  lore.close();
});
