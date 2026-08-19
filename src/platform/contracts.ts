/**
 * Game Plugin Protocol v1.
 *
 * These contracts intentionally do not expose Cordis types. A different
 * platform can implement the same composition contract in the future.
 */
export type CapabilityId = string;

export interface ProvidedCapability {
  /** Stable game-level identifier used by other plugins. */
  id: CapabilityId;
  /** Platform-local service name used to retrieve the implementation. */
  serviceKey: string;
  /** System-only capabilities may be required only by system.* plugins. */
  scope?: "public" | "system";
}

export interface GamePluginManifest {
  id: string;
  version: string;
  configVersion: number;
  requires?: readonly CapabilityId[];
  provides?: readonly ProvidedCapability[];
  ownsEvents?: readonly string[];
  ownsJobs?: readonly string[];
}

/** A platform-specific implementation accompanied by game-owned metadata. */
export interface GamePluginDefinition<Implementation = unknown> {
  manifest: GamePluginManifest;
  implementation: Implementation;
}

export interface PluginEntry {
  plugin: GamePluginDefinition;
  config?: unknown;
  disabled?: boolean;
}

export interface GameComposition {
  profileId: string;
  plugins: readonly PluginEntry[];
}

export interface RunningComposition {
  get<T>(capability: CapabilityId): T;
  dispose(): Promise<void>;
}

/** A loaded plugin together with the state controlled by the runtime. */
export interface ManagedPlugin {
  id: string;
  manifest: GamePluginManifest;
  enabled: boolean;
}

/**
 * Runtime plugin control. Implementations may load only in-process plugins,
 * but callers never need to know the host platform's lifecycle primitives.
 */
export interface PluginManager extends RunningComposition {
  /** Adds a definition in the disabled state unless the entry explicitly enables it. */
  register(entry: PluginEntry): void;
  enable(pluginId: string): Promise<void>;
  disable(pluginId: string): Promise<void>;
  unregister(pluginId: string): Promise<void>;
  list(): readonly ManagedPlugin[];
}

export interface PluginPlatform {
  mount(composition: GameComposition): Promise<RunningComposition>;
  createManager(composition: GameComposition): Promise<PluginManager>;
}

export class CompositionValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CompositionValidationError";
  }
}

/** Validates the game-owned graph before a platform executes third-party code. */
export function validateComposition(composition: GameComposition): void {
  const active = composition.plugins.filter((entry) => !entry.disabled);
  const pluginIds = new Set<string>();
  const providers = new Map<CapabilityId, { pluginId: string; scope: "public" | "system" }>();

  for (const entry of active) {
    const { manifest } = entry.plugin;
    if (!manifest.id.trim()) throw new CompositionValidationError("Plugin id must not be empty.");
    if (pluginIds.has(manifest.id)) throw new CompositionValidationError(`Duplicate plugin id: ${manifest.id}.`);
    pluginIds.add(manifest.id);
    if (!Number.isSafeInteger(manifest.configVersion) || manifest.configVersion < 1) {
      throw new CompositionValidationError(`Plugin ${manifest.id} must declare a positive integer configVersion.`);
    }
    for (const capability of manifest.provides ?? []) {
      if (!capability.id.trim() || !capability.serviceKey.trim()) {
        throw new CompositionValidationError(`Plugin ${manifest.id} has an invalid provided capability.`);
      }
      const existing = providers.get(capability.id);
      if (existing) throw new CompositionValidationError(`Capability ${capability.id} is provided by both ${existing.pluginId} and ${manifest.id}.`);
      providers.set(capability.id, { pluginId: manifest.id, scope: capability.scope ?? "public" });
    }
  }

  for (const entry of active) {
    for (const requirement of entry.plugin.manifest.requires ?? []) {
      const provider = providers.get(requirement);
      if (!provider) {
        throw new CompositionValidationError(`Plugin ${entry.plugin.manifest.id} requires unavailable capability ${requirement}.`);
      }
      if (provider.scope === "system" && !entry.plugin.manifest.id.startsWith("system.")) {
        throw new CompositionValidationError(`Plugin ${entry.plugin.manifest.id} may not require system-only capability ${requirement}.`);
      }
    }
  }

  const dependencies = new Map<string, Set<string>>();
  for (const entry of active) {
    const id = entry.plugin.manifest.id;
    const requiredPlugins = dependencies.get(id) ?? new Set<string>();
    dependencies.set(id, requiredPlugins);
    for (const requirement of entry.plugin.manifest.requires ?? []) {
      requiredPlugins.add(providers.get(requirement)!.pluginId);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, trail: readonly string[]): void => {
    if (visiting.has(id)) {
      const start = trail.indexOf(id);
      throw new CompositionValidationError(`Circular plugin dependency: ${[...trail.slice(start), id].join(" -> ")}.`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of dependencies.keys()) visit(id, []);
}

export function findCapabilityProvider(composition: GameComposition, capability: CapabilityId): ProvidedCapability | undefined {
  for (const entry of composition.plugins) {
    if (entry.disabled) continue;
    const provided = entry.plugin.manifest.provides?.find((item) => item.id === capability);
    if (provided) return provided;
  }
  return undefined;
}
