import assert from "node:assert/strict";
import test from "node:test";
import type { State } from "./state.js";

test("generic state carries domain slices without importing battle contracts", () => {
  const state: State<{ world: { locationId: string }; economy: { gold: number } }> = {
    sessionId: "session-1", revision: 3,
    domains: { world: { locationId: "hall" }, economy: { gold: 10 } },
  };
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});
