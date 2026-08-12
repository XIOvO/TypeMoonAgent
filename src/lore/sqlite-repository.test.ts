import assert from "node:assert/strict";
import test from "node:test";
import { SqliteLoreRepository } from "./sqlite-repository.js";

test("Lore repository keeps source documents separate and searches CJK script chunks", () => {
  const repository = new SqliteLoreRepository();
  repository.replaceDocument({
    id: "atlas:CN:script:demo", source: "atlas", region: "CN", scriptId: "demo", warId: 100,
    questId: 1, questName: "序章", phase: 1, sourceUrl: "https://example.test/script.txt",
    localPath: "scripts/demo.txt", contentSha1: "abc", byteSize: 42, fetchedAt: "2026-08-12T00:00:00Z",
  }, [{
    id: "atlas:CN:script:demo:chunk:0001", documentId: "atlas:CN:script:demo", chunkOrder: 1,
    text: "玛修在燃烧的冬木街道上提醒前辈保持警戒。", speakerNames: ["玛修"],
  }]);
  assert.equal(repository.countDocuments(), 1);
  assert.equal(repository.countChunks(), 1);
  assert.equal(repository.search("玛修", 3, { region: "CN", warId: 100 })[0]?.speakerNames[0], "玛修");
  assert.match(repository.search("保持警戒", 3)[0]?.text ?? "", /保持警戒/);
  repository.close();
});
