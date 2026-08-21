import assert from "node:assert/strict";
import {
  COMBAT_RESOLVE_CAPABILITY,
  createTestRuntime,
} from "agent-game-runtime/sdk";
import type {
  CombatResolveCommandPayload,
  CommandEnvelope,
  CommandResult,
  PluginDefinition,
} from "agent-game-runtime/sdk";
import type { CombatResolveCapability } from "./index.js";

export function combatCommand(
  payload: CombatResolveCommandPayload,
  id = "combat-command-1",
): CommandEnvelope<CombatResolveCommandPayload> {
  return {
    id,
    sessionId: "session-1",
    type: COMBAT_RESOLVE_CAPABILITY,
    actorId: "player-1",
    payload,
    causation: { playerActionId: "action-1" },
    correlationId: "correlation-1",
  };
}

export async function runCombatProviderConformance(
  plugin: PluginDefinition,
  config?: unknown,
): Promise<CommandResult> {
  const runtime = await createTestRuntime({
    plugins: [{ plugin, config }],
  });
  try {
    assert.equal(
      plugin.manifest.provides?.filter((definition) => definition.id === COMBAT_RESOLVE_CAPABILITY).length,
      1,
    );
    const combat = runtime.getCapability<CombatResolveCapability>(COMBAT_RESOLVE_CAPABILITY);
    const result = await combat.execute(combatCommand({
      participation: "command",
      commands: [{ intent: "attack", targetId: "enemy-1" }],
    }));

    assert.equal(result.accepted, true);
    const events = result.events ?? [];
    assert.ok(events.length > 0);
    const namespaces = plugin.manifest.ownsEvents?.map((ownership) => ownership.namespace) ?? [];
    for (const event of events) {
      assert.ok(namespaces.some((namespace) => event.type.startsWith(namespace + ".")));
      assert.equal("id" in event, false);
      assert.equal("sequence" in event, false);
      assert.equal("stateRevision" in event, false);
    }

    const invalid = await combat.execute({
      ...combatCommand({ participation: "quick_resolve" }, "combat-invalid"),
      actorId: "",
    });
    assert.deepEqual(invalid, {
      accepted: false,
      rejection: { code: "combat.command_invalid" },
    });
    return result;
  } finally {
    await runtime.dispose();
  }
}
