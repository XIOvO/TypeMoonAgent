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

/** A Game Plugin Protocol definition implemented with the currently selected platform. */
export interface CordisGamePluginDefinition<Config = unknown> extends GamePluginDefinition<Plugin<Config>> {}

/**
 * Cordis implementation of the platform seam. Only this file imports Cordis,
 * keeping all game plugins portable at the protocol boundary.
 */
export class CordisPlatformAdapter implements PluginPlatform {
  public async mount(composition: GameComposition): Promise<RunningComposition> {
    return this.createManager(composition);
  }

  public async createManager(composition: GameComposition): Promise<PluginManager> {
    return CordisPluginManager.create(composition);
  }
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
