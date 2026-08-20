import { Service, type Context } from "@deepseek-ai/cordis";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import { COMBAT_RESOLVE_CAPABILITY, isCombatResolveCommand } from "../../protocol/combat-commands.js";
import type { CommandEnvelope } from "../../protocol/command.js";
import type { CombatResolveController } from "./combat-resolve.js";

/** Swap-test provider: validates the public command without applying battle mechanics. */
export class DummyCombatResolver implements CombatResolveController {
  public constructor(private readonly commands: Pick<CommandGateway, "getState">) {}

  public async execute(command: CommandEnvelope) {
    if (!isCombatResolveCommand(command)) throw new Error("combat_command_invalid");
    return { actionId: command.id, events: [], stateRevision: this.commands.getState().revision };
  }
}

class DummyCombatService extends Service implements CombatResolveController {
  public constructor(ctx: Context, private readonly controller: CombatResolveController) { super(ctx, "combatResolve"); }
  public execute(command: CommandEnvelope) { return this.controller.execute(command); }
}

/** Alternative combat.resolve provider used to prove composition-level replacement. */
export function createDummyCombatPlugin(commands: Pick<CommandGateway, "getState">): CordisGamePluginDefinition {
  const controller = new DummyCombatResolver(commands);
  return {
    manifest: {
      id: "feature.dummy-combat",
      version: "1.0.0",
      configVersion: 1,
      requires: ["world.commandGateway"],
      provides: [{ id: COMBAT_RESOLVE_CAPABILITY, serviceKey: "combatResolve" }],
    },
    implementation: (ctx: Context) => { new DummyCombatService(ctx, controller); },
  };
}
