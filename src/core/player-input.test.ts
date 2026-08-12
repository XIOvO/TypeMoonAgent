import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicPlayerInputInterpreter } from "./player-input.js";

test("explicit player input lanes resolve without an AI interpreter", async () => {
  const result = await new DeterministicPlayerInputInterpreter().interpret({
    id: "input-1", sessionId: "demo", actorId: "player", mode: "dialogue", content: "Hello", targetIds: ["mash"],
  });
  assert.deepEqual(result, { kind: "resolved", action: {
    id: "input-1", sessionId: "demo", actorId: "player", type: "dialogue", content: "Hello", targetIds: ["mash"], parameters: undefined,
  } });
});

test("ambiguous mixed freeform input is not silently made public dialogue", async () => {
  const result = await new DeterministicPlayerInputInterpreter().interpret({
    id: "input-2", sessionId: "demo", actorId: "player", mode: "auto", content: "I nod and say I am fine, while hiding my fear.",
  });
  assert.deepEqual(result, { kind: "needs_interpreter", reason: "ambiguous_freeform_input" });
});
