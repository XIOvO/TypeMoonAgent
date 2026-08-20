import { Context, type Fiber, type Plugin } from "@deepseek-ai/cordis";
import {
  type GameComposition,
  type GamePluginDefinition,
  type ManagedPlugin,
  type PluginEntry,
  type PluginManager,
  type PluginPlatform,
  type RunningComposition,
  findCapabilityProvider,
  validateComposition,
} from "./contracts.js";
import type { PluginEffect, PluginSetupContext } from "./plugin-context.js";
import type { CapabilityId, PluginId } from "../protocol/ids.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { isCapabilityVersionCompatible } from "./capability-version.js";
import type { PluginManifestV2 } from "./plugin-manifest.js";

/**
 * Cordis-backed implementation of the game plugin setup boundary.
 *
 * It intentionally delegates effect ownership to Cordis; this adapter does
 * not keep a parallel cleanup registry.
 */
export function createCordisPluginSetupContext(pluginId: PluginId, context: Context): PluginSetupContext {
  return {
    pluginId,
    effect(effect: PluginEffect, label?: string) {
      return context.effect(effect, label);
    },
  };
}

/** Host-only mapping for a v2 capability to the existing Cordis service name. */
export interface CordisCapabilityBinding {
  capabilityId: CapabilityId;
  serviceKey: string;
}

/** A v2 game manifest paired with a Cordis implementation and host bindings. */
export interface CordisPluginDefinitionV2<Config = unknown> {
  manifest: PluginManifestV2;
  implementation: Plugin<Config>;
  bindings?: readonly CordisCapabilityBinding[];
}

export interface CordisPluginEntryV2 {
  plugin: CordisPluginDefinitionV2;
  config?: unknown;
  disabled?: boolean;
}

export interface CordisCompositionV2 {
  profileId: string;
  plugins: readonly CordisPluginEntryV2[];
}

/** A Game Plugin Protocol definition implemented with the currently selected platform. */
export interface CordisGamePluginDefinition<Config = unknown> extends GamePluginDefinition<Plugin<Config>> {}

/**
 * Cordis implementation of the platform seam. Only this file imports Cordis,
 * keeping all game plugins portable at the protocol boundary.
 */
export class CordisPlatformAdapter implements PluginPlatform {
  public constructor(public readonly capabilities = new CapabilityRegistry()) {}

  public async mount(composition: GameComposition): Promise<RunningComposition> {
    return this.createManager(composition);
  }

  public async createManager(composition: GameComposition): Promise<PluginManager> {
    return CordisPluginManager.create(composition);
  }

  /**
   * Validates the game-owned v2 contract, then reuses the existing Cordis
   * manager and lifecycle rather than introducing a second plugin runtime.
   */
  public async mountV2(composition: CordisCompositionV2): Promise<RunningComposition> {
    validateCordisCompositionV2(composition);
    const active = composition.plugins.filter((entry) => !entry.disabled);
    const running = await this.mount({
      profileId: composition.profileId,
      plugins: composition.plugins.map((entry) => ({
        config: entry.config,
        disabled: entry.disabled,
        plugin: {
          implementation: entry.plugin.implementation,
          manifest: {
            id: entry.plugin.manifest.id,
            version: entry.plugin.manifest.version,
            configVersion: entry.plugin.manifest.configVersion,
            requires: entry.plugin.manifest.requires?.map((requirement) => requirement.id),
            provides: entry.plugin.manifest.provides?.map((capability) => ({
              id: capability.id,
              serviceKey: bindingFor(entry.plugin, capability.id),
              scope: capability.scope,
            })),
            ownsEvents: entry.plugin.manifest.ownsEvents?.map((event) => event.namespace),
            ownsJobs: entry.plugin.manifest.ownsJobs,
          },
        },
      })),
    });
    const registered: Array<{ pluginId: PluginId; capabilityId: CapabilityId }> = [];
    try {
      for (const entry of active) {
        for (const definition of entry.plugin.manifest.provides ?? []) {
          this.capabilities.register(entry.plugin.manifest.id, {
            definition,
            implementation: running.get(definition.id),
          });
          registered.push({ pluginId: entry.plugin.manifest.id, capabilityId: definition.id });
        }
      }
    } catch (error) {
      for (const registration of registered.reverse()) {
        this.capabilities.unregister(registration.pluginId, registration.capabilityId);
      }
      await running.dispose();
      throw error;
    }

    let disposed = false;
    return {
      get: <T>(capability: string): T => this.capabilities.resolve<T>({ id: capability as CapabilityId }, "system"),
      dispose: async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        for (const registration of registered.reverse()) {
          this.capabilities.unregister(registration.pluginId, registration.capabilityId);
        }
        await running.dispose();
      },
    };
  }
}

export function validateCordisCompositionV2(composition: CordisCompositionV2): void {
  const active = composition.plugins.filter((entry) => !entry.disabled);
  const providers = new Map<CapabilityId, { plugin: CordisPluginDefinitionV2; version: string; scope: "public" | "system" }>();
  for (const entry of active) {
    const { manifest } = entry.plugin;
    if (!manifest.id || !manifest.version || !manifest.apiVersion) throw new Error("plugin_manifest_invalid");
    for (const capability of manifest.provides ?? []) {
      if (providers.has(capability.id)) throw new Error("capability_duplicate_provider");
      bindingFor(entry.plugin, capability.id);
      providers.set(capability.id, { plugin: entry.plugin, version: capability.version, scope: capability.scope });
    }
  }
  for (const entry of active) {
    for (const requirement of entry.plugin.manifest.requires ?? []) {
      const provider = providers.get(requirement.id);
      if (!provider) throw new Error("capability_not_found");
      if (!isCapabilityVersionCompatible(provider.version, requirement.version)) throw new Error("capability_version_mismatch");
      if (provider.scope === "system" && entry.plugin.manifest.type !== "system") throw new Error("plugin_permission_denied");
    }
  }
}

function bindingFor(plugin: CordisPluginDefinitionV2, capabilityId: CapabilityId): string {
  const serviceKey = plugin.bindings?.find((binding) => binding.capabilityId === capabilityId)?.serviceKey;
  if (!serviceKey) throw new Error("cordis_capability_binding_missing");
  return serviceKey;
}

/**
 * Manages individual Cordis fibers within one game context. It intentionally
 * accepts only already-loaded definitions: package discovery and sandboxing
 * belong to a separate host layer.
 */
export class CordisPluginManager implements PluginManager {
  private readonly context = new Context();
  private readonly entries = new Map<string, PluginEntry>();
  private readonly fibers = new Map<string, Fiber>();
  private readonly mountedOrder: string[] = [];
  private disposed = false;

  private constructor(private readonly profileId: string) {}

  public static async create(composition: GameComposition): Promise<CordisPluginManager> {
    const manager = new CordisPluginManager(composition.profileId);
    for (const entry of composition.plugins) manager.register({ ...entry, disabled: true });
    for (const entry of composition.plugins) {
      if (!entry.disabled) manager.setEnabled(entry.plugin.manifest.id, true);
    }
    try {
      validateComposition(manager.composition());
      for (const id of manager.dependencyOrder()) await manager.mount(id);
      return manager;
    } catch (error) {
      await manager.dispose();
      throw error;
    }
  }

  public register(entry: PluginEntry): void {
    this.assertOpen();
    const id = entry.plugin.manifest.id;
    if (this.entries.has(id)) throw new Error(`Plugin ${id} is already registered.`);
    this.entries.set(id, { ...entry, disabled: entry.disabled ?? true });
  }

  public async enable(pluginId: string): Promise<void> {
    this.assertOpen();
    const entry = this.entry(pluginId);
    if (!entry.disabled) return;
    this.setEnabled(pluginId, true);
    try {
      validateComposition(this.composition());
      await this.mount(pluginId);
    } catch (error) {
      this.setEnabled(pluginId, false);
      throw error;
    }
  }

  public async disable(pluginId: string): Promise<void> {
    this.assertOpen();
    const entry = this.entry(pluginId);
    if (entry.disabled) return;
    const dependents = this.activeDependents(pluginId);
    if (dependents.length > 0) throw new Error(`Plugin ${pluginId} is required by active plugins: ${dependents.join(", ")}.`);
    this.setEnabled(pluginId, false);
    await this.unmount(pluginId);
  }

  public async unregister(pluginId: string): Promise<void> {
    this.assertOpen();
    if (!this.entry(pluginId).disabled) await this.disable(pluginId);
    this.entries.delete(pluginId);
  }

  public list(): readonly ManagedPlugin[] {
    return [...this.entries.values()].map((entry) => ({ id: entry.plugin.manifest.id, manifest: entry.plugin.manifest, enabled: !entry.disabled }));
  }

  public get<T>(capability: string): T {
    this.assertOpen();
    const provider = findCapabilityProvider(this.composition(), capability);
    if (!provider) throw new Error(`Capability ${capability} is not provided by an active plugin.`);
    const value = (this.context as unknown as Record<string, unknown>)[provider.serviceKey];
    if (value === undefined) throw new Error(`Capability ${capability} was declared but service ${provider.serviceKey} was not registered.`);
    return value as T;
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.allSettled([...this.mountedOrder].reverse().map((id) => this.unmount(id)));
  }

  private composition(): GameComposition { return { profileId: this.profileId, plugins: [...this.entries.values()] }; }
  private entry(id: string): PluginEntry { const entry = this.entries.get(id); if (!entry) throw new Error(`Plugin ${id} is not registered.`); return entry; }
  private setEnabled(id: string, enabled: boolean): void { this.entries.set(id, { ...this.entry(id), disabled: !enabled }); }
  private assertOpen(): void { if (this.disposed) throw new Error("Plugin manager has been disposed."); }

  private async mount(id: string): Promise<void> {
    if (this.fibers.has(id)) return;
    const entry = this.entry(id);
    const fiber = this.context.plugin((entry.plugin as CordisGamePluginDefinition).implementation, entry.config);
    try {
      await fiber.await();
      this.fibers.set(id, fiber);
      this.mountedOrder.push(id);
    } catch (error) {
      await fiber.dispose();
      throw error;
    }
  }

  private async unmount(id: string): Promise<void> {
    const fiber = this.fibers.get(id);
    if (!fiber) return;
    this.fibers.delete(id);
    const index = this.mountedOrder.indexOf(id);
    if (index >= 0) this.mountedOrder.splice(index, 1);
    await fiber.dispose();
  }

  private dependencyOrder(): string[] {
    const composition = this.composition();
    const providers = new Map<string, string>();
    for (const entry of composition.plugins) if (!entry.disabled) {
      for (const capability of entry.plugin.manifest.provides ?? []) providers.set(capability.id, entry.plugin.manifest.id);
    }
    const ordered: string[] = [];
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);
      const entry = this.entry(id);
      for (const requirement of entry.plugin.manifest.requires ?? []) visit(providers.get(requirement)!);
      ordered.push(id);
    };
    for (const entry of composition.plugins) if (!entry.disabled) visit(entry.plugin.manifest.id);
    return ordered;
  }

  private activeDependents(pluginId: string): string[] {
    const provided = new Set(this.entry(pluginId).plugin.manifest.provides?.map((item) => item.id) ?? []);
    return [...this.entries.values()]
      .filter((entry) => !entry.disabled && entry.plugin.manifest.id !== pluginId)
      .filter((entry) => (entry.plugin.manifest.requires ?? []).some((requirement) => provided.has(requirement)))
      .map((entry) => entry.plugin.manifest.id);
  }
}
