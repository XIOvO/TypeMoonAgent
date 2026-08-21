import { isCapabilityVersionCompatible } from "../platform/capability-version.js";
import type {
  CapabilityDefinitionInput,
  CapabilityRequirementInput,
  CreateTestRuntimeOptions,
  PluginDefinition,
  PluginDisposer,
  PluginLogger,
  PluginRuntimeContext,
  TestCapabilityDescriptor,
  TestLogEntry,
  TestPluginEntry,
  TestRuntime,
} from "./types.js";

interface ProviderRecord {
  readonly definition: CapabilityDefinitionInput;
  readonly implementation: unknown;
  readonly pluginId: string;
}

interface PlannedProvider {
  readonly definition: CapabilityDefinitionInput;
  readonly pluginId: string;
  readonly entry?: TestPluginEntry;
}

interface PluginScope {
  readonly entry: TestPluginEntry;
  readonly cleanups: PluginDisposer[];
  readonly effectReadiness: Promise<PluginDisposer>[];
  readonly provided: Set<string>;
}

/**
 * Starts portable SDK plugins against an in-memory capability and lifecycle host.
 *
 * The harness never creates an HTTP server, Cordis context, database connection,
 * or committed GameEvent. Persistence and command ports can be supplied as plain
 * capability implementations by the test.
 */
export async function createTestRuntime(options: CreateTestRuntimeOptions = {}): Promise<TestRuntime> {
  const entries = [...(options.plugins ?? [])].filter((entry) => !entry.disabled);
  const providers = new Map<string, ProviderRecord>();
  const planned = new Map<string, PlannedProvider>();
  const scopes: PluginScope[] = [];
  const logEntries: TestLogEntry[] = [];
  let disposed = false;

  const pluginIds = new Set<string>();
  for (const entry of entries) {
    assertManifest(entry.plugin);
    const pluginId = entry.plugin.manifest.id;
    if (pluginIds.has(pluginId)) throw new Error("plugin_duplicate");
    pluginIds.add(pluginId);
  }

  for (const provider of options.capabilities ?? []) {
    assertCapability(provider.definition);
    const pluginId = provider.pluginId?.trim() || "test.host";
    reserve(planned, provider.definition, pluginId);
    providers.set(provider.definition.id, {
      definition: provider.definition,
      implementation: provider.implementation,
      pluginId,
    });
  }

  for (const entry of entries) {
    for (const definition of entry.plugin.manifest.provides ?? []) {
      assertCapability(definition);
      reserve(planned, definition, entry.plugin.manifest.id, entry);
    }
  }

  validateRequirements(entries, planned);
  const setupOrder = dependencyOrder(entries, planned);

  try {
    for (const entry of setupOrder) {
      const scope: PluginScope = { entry, cleanups: [], effectReadiness: [], provided: new Set() };
      scopes.push(scope);
      const context = createContext(scope, providers, logEntries, () => disposed);
      await entry.plugin.setup(context);
      await Promise.all(scope.effectReadiness);
      for (const definition of entry.plugin.manifest.provides ?? []) {
        if (!scope.provided.has(definition.id)) throw new Error(`plugin_capability_not_provided:${definition.id}`);
      }
    }
  } catch (error) {
    await disposeScopes(scopes, true);
    throw error;
  }

  const assertOpen = (): void => {
    if (disposed) throw new Error("test_runtime_disposed");
  };

  return {
    getCapability<T>(id: string, version?: string): T {
      assertOpen();
      return resolveCapability<T>(providers, id, version, "system");
    },
    hasCapability(id: string, version?: string): boolean {
      assertOpen();
      return hasCapability(providers, id, version, "system");
    },
    listCapabilities(): readonly TestCapabilityDescriptor[] {
      assertOpen();
      return [...providers.values()].map(({ definition, pluginId }) => ({ ...definition, pluginId }));
    },
    listPluginIds(): readonly string[] {
      assertOpen();
      return setupOrder.map((entry) => entry.plugin.manifest.id);
    },
    logs(): readonly TestLogEntry[] {
      assertOpen();
      return logEntries.map((entry) => ({ ...entry }));
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await disposeScopes(scopes, false);
    },
  };
}

function createContext(
  scope: PluginScope,
  providers: Map<string, ProviderRecord>,
  logs: TestLogEntry[],
  isDisposed: () => boolean,
): PluginRuntimeContext {
  const { manifest } = scope.entry.plugin;
  const requesterScope = manifest.type === "system" ? "system" : "public";
  const requirementFor = (id: string): CapabilityRequirementInput | undefined =>
    manifest.requires?.find((requirement) => requirement.id === id);
  const owns = (id: string): boolean => manifest.provides?.some((definition) => definition.id === id) ?? false;

  const effect = (start: () => PluginDisposer | Promise<PluginDisposer>): PluginDisposer => {
    if (isDisposed()) throw new Error("test_runtime_disposed");
    const readiness = Promise.resolve(start());
    scope.effectReadiness.push(readiness);
    let cleaned = false;
    const cleanup: PluginDisposer = async () => {
      if (cleaned) return;
      cleaned = true;
      const dispose = await readiness;
      await dispose();
    };
    scope.cleanups.push(cleanup);
    return cleanup;
  };

  const logger = createLogger(manifest.id, logs);
  const context: PluginRuntimeContext = {
    pluginId: manifest.id as PluginRuntimeContext["pluginId"],
    config: scope.entry.config,
    logger,
    effect,
    lifecycle: { effect },
    capabilities: {
      get<T>(id: string, version?: string): T {
        if (isDisposed()) throw new Error("test_runtime_disposed");
        const requirement = requirementFor(id);
        if (!requirement && !owns(id)) throw new Error(`plugin_capability_not_declared:${id}`);
        return resolveCapability<T>(providers, id, version ?? requirement?.version, requesterScope);
      },
      has(id: string, version?: string): boolean {
        if (isDisposed()) throw new Error("test_runtime_disposed");
        const requirement = requirementFor(id);
        if (!requirement && !owns(id)) return false;
        return hasCapability(providers, id, version ?? requirement?.version, requesterScope);
      },
      provide<T>(definition: CapabilityDefinitionInput, implementation: T): PluginDisposer {
        if (isDisposed()) throw new Error("test_runtime_disposed");
        const declared = manifest.provides?.find((candidate) => candidate.id === definition.id);
        if (!declared) throw new Error(`plugin_capability_not_declared:${definition.id}`);
        if (declared.version !== definition.version || declared.scope !== definition.scope) {
          throw new Error(`plugin_capability_definition_mismatch:${definition.id}`);
        }
        if (providers.has(definition.id)) throw new Error(`capability_duplicate_provider:${definition.id}`);
        const record: ProviderRecord = { definition, implementation, pluginId: manifest.id };
        providers.set(definition.id, record);
        scope.provided.add(definition.id);
        let cleaned = false;
        const cleanup: PluginDisposer = () => {
          if (cleaned) return;
          cleaned = true;
          if (providers.get(definition.id) === record) providers.delete(definition.id);
          scope.provided.delete(definition.id);
        };
        scope.cleanups.push(cleanup);
        return cleanup;
      },
    },
  };
  return context;
}

function createLogger(pluginId: string, logs: TestLogEntry[]): PluginLogger {
  const write = (level: TestLogEntry["level"], message: string, details?: Readonly<Record<string, unknown>>): void => {
    logs.push({ pluginId, level, message, ...(details ? { details } : {}) });
  };
  return {
    debug: (message, details) => write("debug", message, details),
    info: (message, details) => write("info", message, details),
    warn: (message, details) => write("warn", message, details),
    error: (message, details) => write("error", message, details),
  };
}

function validateRequirements(entries: readonly TestPluginEntry[], planned: ReadonlyMap<string, PlannedProvider>): void {
  for (const entry of entries) {
    for (const requirement of entry.plugin.manifest.requires ?? []) {
      const provider = planned.get(requirement.id);
      if (!provider) {
        if (requirement.optional) continue;
        throw new Error(`capability.not_found:${requirement.id}`);
      }
      if (!isCapabilityVersionCompatible(provider.definition.version, requirement.version)) {
        throw new Error(`capability.version_mismatch:${requirement.id}`);
      }
      if (provider.definition.scope === "system" && entry.plugin.manifest.type !== "system") {
        throw new Error(`plugin.permission_denied:${requirement.id}`);
      }
    }
  }
}

function dependencyOrder(
  entries: readonly TestPluginEntry[],
  planned: ReadonlyMap<string, PlannedProvider>,
): TestPluginEntry[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: TestPluginEntry[] = [];

  const visit = (entry: TestPluginEntry, trail: readonly string[]): void => {
    const id = entry.plugin.manifest.id;
    if (visiting.has(id)) throw new Error(`plugin.dependency_cycle:${[...trail, id].join("->")}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const requirement of entry.plugin.manifest.requires ?? []) {
      const dependency = planned.get(requirement.id)?.entry;
      if (dependency) visit(dependency, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(entry);
  };

  for (const entry of entries) visit(entry, []);
  return ordered;
}

function reserve(
  planned: Map<string, PlannedProvider>,
  definition: CapabilityDefinitionInput,
  pluginId: string,
  entry?: TestPluginEntry,
): void {
  if (planned.has(definition.id)) throw new Error(`capability_duplicate_provider:${definition.id}`);
  planned.set(definition.id, { definition, pluginId, ...(entry ? { entry } : {}) });
}

function assertManifest(plugin: PluginDefinition): void {
  const { manifest } = plugin;
  if (
    !manifest.id.trim() ||
    !manifest.version.trim() ||
    !manifest.apiVersion.trim() ||
    !Number.isSafeInteger(manifest.configVersion) ||
    manifest.configVersion < 1
  ) throw new Error("plugin_manifest_invalid");
  for (const requirement of manifest.requires ?? []) {
    if (!requirement.id.trim()) throw new Error("plugin_manifest_invalid");
  }
}

function assertCapability(definition: CapabilityDefinitionInput): void {
  if (
    !definition.id.trim() ||
    !isCapabilityVersionCompatible(definition.version, definition.version) ||
    (definition.scope !== "public" && definition.scope !== "system")
  ) throw new Error("capability_definition_invalid");
}

function resolveCapability<T>(
  providers: ReadonlyMap<string, ProviderRecord>,
  id: string,
  version: string | undefined,
  requesterScope: "public" | "system",
): T {
  const provider = providers.get(id);
  if (!provider) throw new Error(`capability.not_found:${id}`);
  if (!isCapabilityVersionCompatible(provider.definition.version, version)) {
    throw new Error(`capability.version_mismatch:${id}`);
  }
  if (provider.definition.scope === "system" && requesterScope !== "system") {
    throw new Error(`plugin.permission_denied:${id}`);
  }
  return provider.implementation as T;
}

function hasCapability(
  providers: ReadonlyMap<string, ProviderRecord>,
  id: string,
  version: string | undefined,
  requesterScope: "public" | "system",
): boolean {
  try {
    resolveCapability(providers, id, version, requesterScope);
    return true;
  } catch {
    return false;
  }
}

async function disposeScopes(scopes: readonly PluginScope[], suppressErrors: boolean): Promise<void> {
  let firstError: unknown;
  for (const scope of [...scopes].reverse()) {
    for (const cleanup of [...scope.cleanups].reverse()) {
      try {
        await cleanup();
      } catch (error) {
        firstError ??= error;
      }
    }
  }
  if (!suppressErrors && firstError !== undefined) throw firstError;
}
