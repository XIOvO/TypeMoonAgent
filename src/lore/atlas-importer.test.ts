import assert from "node:assert/strict";
import test from "node:test";
import { chunkScript } from "./atlas-importer.js";

test("Atlas Script chunking keeps readable dialogue blocks and speaker labels", () => {
  const chunks = chunkScript("atlas:CN:script:demo", "[scene 1]\n\n＠A：玛修\n前辈，请小心。\n[k]\n\n＠B：罗曼\n前方有异常反应。\n[k]", 80);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0]?.text ?? "", /前辈，请小心/);
  assert.deepEqual(chunks[0]?.speakerNames, ["玛修", "罗曼"]);
});
