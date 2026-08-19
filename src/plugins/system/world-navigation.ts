import { Service, type Context } from "@deepseek-ai/cordis";
import type { NavigationPlanner, NavigationRoute } from "../../core/navigation.js";
import type { WorldStateReader } from "../../core/world-state.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import { WORLD_MAP_CAPABILITY } from "./world-map.js";

export const WORLD_NAVIGATION_CAPABILITY = "world.navigation";

/** Navigation query over the latest committed map state. */
export interface WorldNavigation {
  findRoute(from: string, destination: string): NavigationRoute;
}

export class CommittedWorldNavigation implements WorldNavigation, NavigationPlanner {
  public constructor(private readonly worldState: WorldStateReader, private readonly planner: NavigationPlanner) {}
  public findRoute(from: string, destination: string): NavigationRoute;
  public findRoute(world: Parameters<NavigationPlanner["findRoute"]>[0], from: string, destination: string): NavigationRoute;
  public findRoute(
    worldOrFrom: Parameters<NavigationPlanner["findRoute"]>[0] | string,
    fromOrDestination: string,
    destination?: string,
  ): NavigationRoute {
    if (typeof worldOrFrom === "string") return this.planner.findRoute(this.worldState.getSnapshot(), worldOrFrom, fromOrDestination);
    return this.planner.findRoute(worldOrFrom, fromOrDestination, destination!);
  }
}

class WorldNavigationService extends Service implements WorldNavigation {
  public constructor(ctx: Context, private readonly navigation: WorldNavigation) { super(ctx, "worldNavigation"); }
  public findRoute(from: string, destination: string) { return this.navigation.findRoute(from, destination); }
}

/** M1 navigation adapter: route semantics remain the existing sorted BFS graph. */
export function createWorldNavigationPlugin(navigation: WorldNavigation): CordisGamePluginDefinition {
  return {
    manifest: {
      id: "system.world-navigation",
      version: "1.0.0",
      configVersion: 1,
      requires: [WORLD_MAP_CAPABILITY],
      provides: [{ id: WORLD_NAVIGATION_CAPABILITY, serviceKey: "worldNavigation" }],
    },
    implementation: (ctx: Context) => { new WorldNavigationService(ctx, navigation); },
  };
}
