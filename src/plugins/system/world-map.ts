import { Service, type Context } from "@deepseek-ai/cordis";
import { type WorldMap } from "../../core/world-map.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import { WORLD_STATE_CAPABILITY } from "./world-state.js";

export const WORLD_MAP_CAPABILITY = "world.map";

class WorldMapService extends Service implements WorldMap {
  public constructor(ctx: Context, private readonly map: WorldMap) { super(ctx, "worldMap"); }
  public getLocation(locationId: string) { return this.map.getLocation(locationId); }
  public getConnectedLocationIds(locationId: string) { return this.map.getConnectedLocationIds(locationId); }
}

/** M1 map adapter: exposes the existing committed locations/exits topology. */
export function createWorldMapPlugin(map: WorldMap): CordisGamePluginDefinition {
  return {
    manifest: {
      id: "system.world-map",
      version: "1.0.0",
      configVersion: 1,
      requires: [WORLD_STATE_CAPABILITY],
      provides: [{ id: WORLD_MAP_CAPABILITY, serviceKey: "worldMap" }],
    },
    implementation: (ctx: Context) => { new WorldMapService(ctx, map); },
  };
}
