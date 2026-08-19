import type { GameComposition, PluginPlatform, RunningComposition } from "./contracts.js";

/**
 * The only non-game bootstrap seam: choose a platform and mount a composition.
 * It deliberately knows nothing about Runtime, persistence, maps, or stories.
 */
export async function bootstrap(platform: PluginPlatform, composition: GameComposition): Promise<RunningComposition> {
  return platform.mount(composition);
}
