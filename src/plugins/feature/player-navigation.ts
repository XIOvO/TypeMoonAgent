import { Service, type Context } from "@deepseek-ai/cordis";
import type { ActionResult } from "../../core/contracts.js";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import { NAVIGATION_MOVE_CAPABILITY, isNavigationMoveCommand } from "../../protocol/navigation-commands.js";
import type { CommandEnvelope } from "../../protocol/command.js";

export interface NavigationMoveController {
  execute(command: CommandEnvelope): Promise<ActionResult>;
}

/** Compatibility adapter for the public navigation.move command. */
export class PlayerNavigationResolver implements NavigationMoveController {
  public constructor(private readonly commands: CommandGateway) {}

  public async execute(command: CommandEnvelope): Promise<ActionResult> {
    if (!isNavigationMoveCommand(command)) throw new Error("navigation_move_command_invalid");
    return this.commands.handlePlayerAction({
      id: command.id,
      sessionId: command.sessionId,
      actorId: command.actorId,
      type: "action",
      parameters: { intent: "move", destination: command.payload.destination },
    });
  }
}

class NavigationMoveService extends Service implements NavigationMoveController {
  public constructor(ctx: Context, private readonly controller: NavigationMoveController) { super(ctx, "navigationMove"); }
  public execute(command: CommandEnvelope) { return this.controller.execute(command); }
}

export function createPlayerNavigationPlugin(commands: CommandGateway): CordisGamePluginDefinition {
  const controller = new PlayerNavigationResolver(commands);
  return {
    manifest: {
      id: "feature.player-navigation",
      version: "1.0.0",
      configVersion: 1,
      requires: ["world.commandGateway"],
      provides: [{ id: NAVIGATION_MOVE_CAPABILITY, serviceKey: "navigationMove" }],
    },
    implementation: (ctx: Context) => { new NavigationMoveService(ctx, controller); },
  };
}
