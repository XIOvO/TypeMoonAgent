import assert from "node:assert/strict";
import test from "node:test";
import { SqliteLoreRepository } from "./sqlite-repository.js";

test("Lore repository keeps source-linked fragments separate and searches CJK dialogue", () => {
  const repository = new SqliteLoreRepository();
  repository.upsertCollection({ id: "atlas:CN:war:100", region: "CN", atlasWarId: 100, contentKind: "main", name: "冬木" });
  repository.upsertStoryNode({ id: "atlas:CN:quest:1", collectionId: "atlas:CN:war:100", atlasQuestId: 1,
    name: "序章", questType: "main", contentKind: "main", unlockKey: "atlas:CN:quest:1:phase:1" });
  repository.upsertPhase({ id: "atlas:CN:quest:1:phase:1", storyNodeId: "atlas:CN:quest:1", phase: 1, scriptIds: ["demo"] });
  repository.replaceDocument({ document: {
    id: "atlas:CN:script:demo", source: "atlas", region: "CN", scriptId: "demo", storyNodeId: "atlas:CN:quest:1",
    phaseId: "atlas:CN:quest:1:phase:1", contentKind: "main", sourceUrl: "https://example.test/script.txt",
    localPath: "scripts/demo.txt", contentSha1: "abc", byteSize: 42, fetchedAt: "2026-08-12T00:00:00Z",
  }, scenes: [], fragments: [{
    id: "atlas:CN:script:demo:fragment:0001", documentId: "atlas:CN:script:demo", fragmentOrder: 1,
    text: "玛修在燃烧的冬木街道上提醒前辈保持警戒。", speakerNames: ["玛修"], dialogueIds: [], spoilerUnlockKey: "atlas:CN:quest:1:phase:1",
  }] });
  assert.equal(repository.countDocuments(), 1);
  assert.equal(repository.countChunks(), 1);
  assert.equal(repository.search("玛修", 3, { region: "CN", warId: 100 })[0]?.speakerNames[0], "玛修");
  assert.match(repository.search("保持警戒", 3)[0]?.text ?? "", /保持警戒/);
  repository.close();
});
