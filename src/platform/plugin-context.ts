import type { PluginId } from "../protocol/ids.js";

/** A cleanup function owned by the host plugin lifecycle. */
export type PluginDisposer = () => void | Promise<void>;

/** A game-owned effect shape that does not expose a host framework type. */
export type PluginEffect = () => PluginDisposer | Promise<PluginDisposer>;

/**
 * The stable setup surface provided to game plugins.
 *
 * The host owns registration and disposal of effects. Implementations must
 * delegate to their lifecycle mechanism rather than maintain another one.
 */
export interface PluginSetupContext {
  readonly pluginId: PluginId;
  effect(effect: PluginEffect, label?: string): PluginDisposer;
}
