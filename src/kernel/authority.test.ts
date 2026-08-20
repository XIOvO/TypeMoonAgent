import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeAuthority } from "./authority.js";

test("authority accepts requests from their matching player, agent, or system principal", () => {
  const authority = new RuntimeAuthority();
  assert.doesNotThrow(() => authority.assertAllowed({ kind: "player", id: "player" }, { kind: "player_action", actorId: "player" }));
  assert.doesNotThrow(() => authority.assertAllowed({ kind: "agent", id: "mash" }, { kind: "agent_action", actorId: "mash" }));
  assert.doesNotThrow(() => authority.assertAllowed({ kind: "system", id: "world-simulation" }, { kind: "system_action" }));
});

test("authority rejects cross-principal requests", () => {
  const authority = new RuntimeAuthority();
  assert.throws(() => authority.assertAllowed({ kind: "agent", id: "mash" }, { kind: "agent_action", actorId: "other" }), /runtime_authority_denied/);
  assert.throws(() => authority.assertAllowed({ kind: "player", id: "player" }, { kind: "system_action" }), /runtime_authority_denied/);
});
