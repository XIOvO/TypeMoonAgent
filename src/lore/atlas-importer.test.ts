import assert from "node:assert/strict";
import test from "node:test";
import { chunkScript, parseAtlasScript } from "./atlas-importer.js";

test("Atlas Script chunking keeps readable dialogue blocks and speaker labels", () => {
  const chunks = chunkScript("atlas:CN:script:demo", "[scene 1]\n\n＠A：玛修\n前辈，请小心。\n[k]\n\n＠B：罗曼\n前方有异常反应。\n[k]", 80);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0]?.text ?? "", /前辈，请小心/);
  assert.deepEqual(chunks[0]?.speakerNames, ["玛修", "罗曼"]);
});

test("Atlas Script parser preserves scene evidence and maps charaSet speakers", () => {
  const documentId = "atlas:CN:script:sample";
  const parsed = parseAtlasScript({ documentId, region: "CN", maxCharacters: 100, rawText: `
[scene 10110]
[charaSet A 98001000 0 玛修]
＠[51d4ff]玛修[-]
[51d4ff]前辈，请小心。[-][r][51d4ff]前方有异常反应。[-]
[k]`, document: {
    id: documentId, source: "atlas", region: "CN", scriptId: "sample", contentKind: "main", sourceUrl: "https://example.test/sample",
    localPath: "scripts/sample.txt", contentSha1: "abc", byteSize: 1, fetchedAt: "2026-08-14T00:00:00Z",
  } });
  assert.equal(parsed.scenes.length, 1);
  assert.equal(parsed.scenes[0]?.atlasSceneId, "10110");
  assert.equal(parsed.scenes[0]?.appearances[0]?.displayName, "玛修");
  assert.match(parsed.scenes[0]?.dialogues[0]?.text ?? "", /前方有异常反应/);
  assert.equal(parsed.scenes[0]?.dialogues[0]?.speakerCharacterId, "atlas:CN:character:玛修");
  assert.deepEqual(parsed.fragments[0]?.dialogueIds, ["atlas:CN:script:sample:scene:0001:dialogue:0001"]);
});
