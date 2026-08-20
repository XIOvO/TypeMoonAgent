import assert from "node:assert/strict";
import test from "node:test";
import { COMBAT_RESOLVE_CAPABILITY, COMBAT_RESOLVE_CAPABILITY_DEFINITION, COMBAT_RESOLVE_COMMAND_SCHEMA, isCombatResolveCommand } from "./combat-commands.js";

const command = (payload: object, actorId = "player") => ({ id: "combat-1", sessionId: "demo", actorId, type: COMBAT_RESOLVE_CAPABILITY, payload, causation: {}, correlationId: "trace-combat" });

test("combat.resolve serializes attack, defend, delegate, and quick-resolve requests", () => {
  assert.equal(isCombatResolveCommand(command({ participation: "command", commands: [{ intent: "attack", targetId: "enemy" }] })), true);
  assert.equal(isCombatResolveCommand(command({ participation: "command", commands: [{ actorId: "mash", intent: "defend" }] })), true);
  assert.equal(isCombatResolveCommand(command({ participation: "delegate", delegateTo: ["mash"] })), true);
  assert.equal(isCombatResolveCommand(command({ participation: "quick_resolve" })), true);
  assert.equal(isCombatResolveCommand(command({ participation: "command", commands: [] })), false);
  assert.equal(isCombatResolveCommand(command({ participation: "quick_resolve", unexpected: true })), false);
  assert.equal(isCombatResolveCommand(command({ participation: "quick_resolve" }, "")), false);
  assert.equal(COMBAT_RESOLVE_CAPABILITY_DEFINITION.id, COMBAT_RESOLVE_CAPABILITY);
  assert.equal(JSON.parse(JSON.stringify(COMBAT_RESOLVE_COMMAND_SCHEMA)).oneOf.length, 3);
});
