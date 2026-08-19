import { Service, type Context } from "@deepseek-ai/cordis";
import { WorldStateStore, type WorldStateReader } from "../../core/world-state.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";

export const WORLD_STATE_CAPABILITY = "world.state";

class WorldStateService extends Service implements WorldStateReader {
  public constructor(ctx: Context, private readonly store: WorldStateStore) { super(ctx, "worldState"); }
  public getSnapshot() { return this.store.getSnapshot(); }
  public subscribe(listener: Parameters<WorldStateReader["subscribe"]>[0]) { return this.store.subscribe(listener); }
}

/**
 * Provides read-only snapshots to plugins. Runtime retains write authority in
 * this compatibility stage and publishes only after a turn commits.
 */
export function createWorldStatePlugin(store: WorldStateStore): CordisGamePluginDefinition {
  return {
    manifest: {
      id: "system.world-state",
      version: "1.0.0",
      configVersion: 1,
      provides: [{ id: WORLD_STATE_CAPABILITY, serviceKey: "worldState" }],
    },
    implementation: (ctx: Context) => {
      new WorldStateService(ctx, store);
      ctx.effect(() => () => store.close());
    },
  };
}
