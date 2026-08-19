import assert from "node:assert/strict";
import test from "node:test";
import { L1_SCENE_MEMORY_PROMPT, L2_PATTERN_CONSOLIDATION_PROMPT } from "./memory-prompts.js";

test("L1 and L2 prompts keep scene memory and cross-scene pattern updates separate", () => {
  assert.match(L1_SCENE_MEMORY_PROMPT, /Do not update trust, beliefs, relationship stages/);
  assert.match(L1_SCENE_MEMORY_PROMPT, /identity, or CIF/);
  assert.match(L2_PATTERN_CONSOLIDATION_PROMPT, /cross-scene patterns/);
  assert.match(L2_PATTERN_CONSOLIDATION_PROMPT, /supporting L1 memory IDs/);
  assert.match(L2_PATTERN_CONSOLIDATION_PROMPT, /Those belong to L3/);
});
