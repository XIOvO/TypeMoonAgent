import { Service, type Context } from "@deepseek-ai/cordis";
import type { ActionResult } from "../../core/contracts.js";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import { COMBAT_RESOLVE_CAPABILITY, isCombatResolveCommand } from "../../protocol/combat-commands.js";
import type { CommandEnvelope } from "../../protocol/command.js";

export interface CombatResolveController {
  execute(command: CommandEnvelope): Promise<ActionResult>;
}

/** Compatibility provider: adapts the public combat command to Runtime's current battle lane. */
export class SimpleCombatResolver implements CombatResolveController {
  public constructor(private readonly commands: CommandGateway) {}

  public async execute(command: CommandEnvelope): Promise<ActionResult> {
    if (!isCombatResolveCommand(command)) throw new Error("combat_command_invalid");
    return this.commands.handlePlayerAction({
      id: command.id,
      sessionId: command.sessionId,
      actorId: command.actorId,
      type: "combat",
      parameters: command.payload,
    });
  }
}

class CombatResolveService extends Service implements CombatResolveController {
  public constructor(ctx: Context, private readonly controller: CombatResolveController) { super(ctx, "combatResolve"); }
  public execute(command: CommandEnvelope) { return this.controller.execute(command); }
}

/** First combat.resolve provider; it preserves the deterministic Runtime resolver as a compatibility implementation. */
export function createSimpleCombatPlugin(commands: CommandGateway): CordisGamePluginDefinition {
  const controller = new SimpleCombatResolver(commands);
  return {
    manifest: {
      id: "feature.simple-combat",
      version: "1.0.0",
      configVersion: 1,
      requires: ["world.commandGateway"],
      provides: [{ id: COMBAT_RESOLVE_CAPABILITY, serviceKey: "combatResolve" }],
    },
    implementation: (ctx: Context) => { new CombatResolveService(ctx, controller); },
  };
}
