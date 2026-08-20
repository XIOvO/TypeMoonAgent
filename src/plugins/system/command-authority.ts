import { Service, type Context } from "@deepseek-ai/cordis";
import type { CommandGateway } from "../../core/command-gateway.js";
import { GameRuntime } from "../../core/runtime.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import { WORLD_STATE_CAPABILITY } from "./world-state.js";
import { WORLD_NAVIGATION_CAPABILITY } from "./world-navigation.js";

export const WORLD_COMMAND_GATEWAY_CAPABILITY = "world.commandGateway";

/**
 * Compatibility implementation: GameRuntime remains the authority engine,
 * while consumers receive only its command contract through this service.
 */
export class RuntimeCommandGateway implements CommandGateway {
  public constructor(private readonly runtime: GameRuntime) {}
  public getState() { return this.runtime.getState(); }
  public subscribe(listener: Parameters<CommandGateway["subscribe"]>[0]) { return this.runtime.subscribe(listener); }
  public execute(command: Parameters<CommandGateway["execute"]>[0]) { return this.runtime.execute(command); }
  public handlePlayerAction(action: Parameters<CommandGateway["handlePlayerAction"]>[0]) { return this.runtime.handlePlayerAction(action); }
  public handleRawPlayerInput(input: Parameters<CommandGateway["handleRawPlayerInput"]>[0]) { return this.runtime.handleRawPlayerInput(input); }
  public enterChapter(request: Parameters<CommandGateway["enterChapter"]>[0]) { return this.runtime.enterChapter(request); }
  public introduceCharacter(request: Parameters<CommandGateway["introduceCharacter"]>[0]) { return this.runtime.introduceCharacter(request); }
  public startBattle(request: Parameters<CommandGateway["startBattle"]>[0]) { return this.runtime.startBattle(request); }
  public runCharacterInitiative(request: Parameters<CommandGateway["runCharacterInitiative"]>[0]) { return this.runtime.runCharacterInitiative(request); }
  public moveCharacterTowardPlayer(request: Parameters<CommandGateway["moveCharacterTowardPlayer"]>[0]) { return this.runtime.moveCharacterTowardPlayer(request); }
}

class RuntimeCommandGatewayService extends Service implements CommandGateway {
  public constructor(ctx: Context, private readonly gateway: CommandGateway) { super(ctx, "worldCommandGateway"); }
  public getState() { return this.gateway.getState(); }
  public subscribe(listener: Parameters<CommandGateway["subscribe"]>[0]) { return this.gateway.subscribe(listener); }
  public execute(command: Parameters<CommandGateway["execute"]>[0]) { return this.gateway.execute(command); }
  public handlePlayerAction(action: Parameters<CommandGateway["handlePlayerAction"]>[0]) { return this.gateway.handlePlayerAction(action); }
  public handleRawPlayerInput(input: Parameters<CommandGateway["handleRawPlayerInput"]>[0]) { return this.gateway.handleRawPlayerInput(input); }
  public enterChapter(request: Parameters<CommandGateway["enterChapter"]>[0]) { return this.gateway.enterChapter(request); }
  public introduceCharacter(request: Parameters<CommandGateway["introduceCharacter"]>[0]) { return this.gateway.introduceCharacter(request); }
  public startBattle(request: Parameters<CommandGateway["startBattle"]>[0]) { return this.gateway.startBattle(request); }
  public runCharacterInitiative(request: Parameters<CommandGateway["runCharacterInitiative"]>[0]) { return this.gateway.runCharacterInitiative(request); }
  public moveCharacterTowardPlayer(request: Parameters<CommandGateway["moveCharacterTowardPlayer"]>[0]) { return this.gateway.moveCharacterTowardPlayer(request); }
}

export interface RuntimeCommandAuthoritySystem {
  plugin: CordisGamePluginDefinition;
  gateway: CommandGateway;
}

export function createRuntimeCommandAuthoritySystem(runtime: GameRuntime): RuntimeCommandAuthoritySystem {
  const gateway = new RuntimeCommandGateway(runtime);
  return {
    gateway,
    plugin: {
      manifest: {
        id: "system.command-authority",
        version: "1.0.0",
        configVersion: 1,
        requires: [WORLD_STATE_CAPABILITY, WORLD_NAVIGATION_CAPABILITY],
        provides: [{ id: WORLD_COMMAND_GATEWAY_CAPABILITY, serviceKey: "worldCommandGateway" }],
      },
      implementation: (ctx: Context) => { new RuntimeCommandGatewayService(ctx, gateway); },
    },
  };
}

export function createRuntimeCommandAuthorityPlugin(runtime: GameRuntime): CordisGamePluginDefinition {
  return createRuntimeCommandAuthoritySystem(runtime).plugin;
}
