import assert from "node:assert/strict";
import test from "node:test";
import {
  COMBAT_RESOLVE_CAPABILITY_DEFINITION,
  createTestRuntime,
  defineEventSchema,
  definePlugin,
  isCombatResolveCommand,
} from "agent-game-runtime/sdk";
import type {
  CommandResult,
  PluginRuntimeContext,
} from "agent-game-runtime/sdk";
import {
  combatCommand,
  runCombatProviderConformance,
} from "./conformance.js";
import {
  COMBAT_ACTION_RESOLVED_EVENT,
  COMBAT_CONTROL_DELEGATED_EVENT,
  COMBAT_QUICK_RESOLVED_EVENT,
  simpleCombatPlugin,
} from "./index.js";
import type { CombatResolveCapability } from "./index.js";

const COMBAT_AVOIDED_EVENT = defineEventSchema({
  type: "combat.battle.avoided",
  schemaVersion: 1,
  payloadSchema: {
    type: "object",
    required: ["actorId"],
    properties: { actorId: { type: "string", minLength: 1 } },
  },
});

const replacementCombatPlugin = definePlugin({
  manifest: {
    id: "example.replacement-combat",
    version: "1.0.0",
    apiVersion: "0.3",
    configVersion: 1,
    type: "feature",
    provides: [COMBAT_RESOLVE_CAPABILITY_DEFINITION],
    ownsEvents: [{ namespace: "combat.battle", versions: [1] }],
  },
  setup(context: PluginRuntimeContext) {
    const implementation: CombatResolveCapability = {
      async execute(command): Promise<CommandResult> {
        if (!isCombatResolveCommand(command)) {
          return {
            accepted: false,
            rejection: { code: "combat.command_invalid" },
          };
        }
        return {
          accepted: true,
          events: [{
            type: COMBAT_AVOIDED_EVENT.type,
            payload: { actorId: command.actorId },
          }],
        };
      },
    };
    context.capabilities.provide(COMBAT_RESOLVE_CAPABILITY_DEFINITION, implementation);
  },
});

test("simple-combat passes the portable combat provider contract", async () => {
  const result = await runCombatProviderConformance(simpleCombatPlugin, { attackDamage: 3 });
  assert.deepEqual(result.events, [{
    type: COMBAT_ACTION_RESOLVED_EVENT.type,
    payload: {
      actorId: "player-1",
      intent: "attack",
      targetId: "enemy-1",
      outcome: "hit",
      damage: 3,
    },
  }]);
});

test("simple-combat resolves delegate and quick-resolve command branches", async (t) => {
  const runtime = await createTestRuntime({
    plugins: [{ plugin: simpleCombatPlugin }],
  });
  t.after(() => runtime.dispose());
  const combat = runtime.getCapability<CombatResolveCapability>(COMBAT_RESOLVE_CAPABILITY_DEFINITION.id);

  const delegated = await combat.execute(combatCommand({
    participation: "delegate",
    delegateTo: ["ally-1"],
  }, "combat-delegate"));
  const quick = await combat.execute(combatCommand({
    participation: "quick_resolve",
  }, "combat-quick"));

  assert.deepEqual(delegated.events, [{
    type: COMBAT_CONTROL_DELEGATED_EVENT.type,
    payload: {
      actorId: "player-1",
      delegateTo: ["ally-1"],
    },
  }]);
  assert.deepEqual(quick.events, [{
    type: COMBAT_QUICK_RESOLVED_EVENT.type,
    payload: {
      actorId: "player-1",
      outcome: "resolved",
    },
  }]);
});

test("a replacement combat provider passes the same contract without changing the host", async () => {
  const result = await runCombatProviderConformance(replacementCombatPlugin);
  assert.equal(result.events?.[0]?.type, COMBAT_AVOIDED_EVENT.type);
});
