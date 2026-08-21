import { createTestRuntime } from "./test-runtime.js";
import type {
  AgentProvider,
  AgentProviderAction,
  AgentProviderObservation,
  BindingQuery,
  PluginDefinition,
  TestCapabilityProvider,
  TestRuntime,
} from "./types.js";

export interface SdkConformanceCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly message?: string;
}

export interface SdkConformanceReport {
  readonly subjectId: string;
  readonly passed: boolean;
  readonly checks: readonly SdkConformanceCheck[];
}

export interface PluginConformanceProbe {
  readonly name: string;
  run(runtime: TestRuntime): void | Promise<void>;
}

export interface RunPluginConformanceOptions {
  readonly plugin: PluginDefinition;
  readonly config?: unknown;
  readonly capabilities?: readonly TestCapabilityProvider[];
  readonly probes?: readonly PluginConformanceProbe[];
  readonly verifyCleanup?: () => void | Promise<void>;
}

export interface RunAgentProviderConformanceOptions {
  readonly provider: AgentProvider;
  readonly matchingQuery: BindingQuery;
  readonly nonMatchingQuery?: BindingQuery;
  readonly observation: AgentProviderObservation;
  readonly verifyAction?: (action: AgentProviderAction) => void | Promise<void>;
}

const pluginTypes = new Set(["system", "feature", "world", "adapter", "provider"]);
const permissions = new Set([
  "world.read",
  "character.read",
  "events.read",
  "jobs.enqueue",
  "model.invoke",
  "network.access",
  "filesystem.access",
]);

export async function runPluginConformance(
  options: RunPluginConformanceOptions,
): Promise<SdkConformanceReport> {
  const checks: SdkConformanceCheck[] = [];
  const manifestSerializable = await record(checks, "manifest.serializable", () => {
    require(isJsonSerializable(options.plugin.manifest), "manifest_not_json_serializable");
  });
  const manifestValid = await record(checks, "manifest.contract", () => {
    assertManifestContract(options.plugin);
  });
  if (!manifestSerializable || !manifestValid) {
    return report(options.plugin.manifest.id || "unknown-plugin", checks);
  }

  let runtime: TestRuntime;
  try {
    runtime = await createTestRuntime({
      plugins: [{ plugin: options.plugin, config: options.config }],
      capabilities: options.capabilities,
    });
    pass(checks, "lifecycle.setup");
  } catch (error) {
    fail(checks, "lifecycle.setup", error);
    if (options.verifyCleanup) {
      await record(checks, "cleanup.rollback", options.verifyCleanup);
    }
    return report(options.plugin.manifest.id, checks);
  }

  const probeNames = new Set<string>();
  for (const probe of options.probes ?? []) {
    const name = probe.name.trim();
    if (!name || probeNames.has(name)) {
      fail(checks, "protocol.probe", new Error("protocol_probe_name_invalid"));
      continue;
    }
    probeNames.add(name);
    await record(checks, "protocol." + name, () => probe.run(runtime));
  }

  await record(checks, "lifecycle.dispose", async () => {
    await runtime.dispose();
    await runtime.dispose();
  });
  if (options.verifyCleanup) {
    await record(checks, "cleanup.verify", options.verifyCleanup);
  }
  await record(checks, "lifecycle.closed", () => {
    try {
      runtime.listPluginIds();
    } catch (error) {
      if (error instanceof Error && error.message === "test_runtime_disposed") return;
      throw error;
    }
    throw new Error("runtime_remained_open_after_dispose");
  });

  return report(options.plugin.manifest.id, checks);
}

export async function runAgentProviderConformance(
  options: RunAgentProviderConformanceOptions,
): Promise<SdkConformanceReport> {
  const checks: SdkConformanceCheck[] = [];
  await record(checks, "provider.identity", () => {
    require(nonEmpty(options.provider.id), "provider_id_invalid");
  });
  await record(checks, "binding.match", () => {
    require(options.provider.supports(options.matchingQuery), "matching_binding_rejected");
  });
  if (options.nonMatchingQuery) {
    await record(checks, "binding.reject", () => {
      require(!options.provider.supports(options.nonMatchingQuery as BindingQuery), "non_matching_binding_accepted");
    });
  }

  let first: AgentProviderAction;
  let second: AgentProviderAction;
  try {
    first = await options.provider.run(options.observation);
    second = await options.provider.run(options.observation);
    pass(checks, "action.run");
  } catch (error) {
    fail(checks, "action.run", error);
    return report(options.provider.id || "unknown-provider", checks);
  }

  await record(checks, "action.protocol", () => {
    require(nonEmpty(first.id), "action_id_invalid");
    require(first.sessionId === options.observation.sessionId, "action_session_mismatch");
    require(first.actorId === options.observation.recipientId, "action_actor_mismatch");
    require(first.observationId === options.observation.id, "action_observation_mismatch");
    require(Array.isArray(first.requests), "action_requests_invalid");
  });
  await record(checks, "action.serializable", () => {
    require(isJsonSerializable(first), "action_not_json_serializable");
  });
  await record(checks, "action.deterministic", () => {
    require(JSON.stringify(first) === JSON.stringify(second), "action_not_deterministic");
  });
  if (options.verifyAction) {
    await record(checks, "protocol.action", () => options.verifyAction?.(first));
  }

  return report(options.provider.id, checks);
}

function assertManifestContract(plugin: PluginDefinition): void {
  const { manifest } = plugin;
  require(nonEmpty(manifest.id), "plugin_id_invalid");
  require(semver(manifest.version), "plugin_version_invalid");
  require(nonEmpty(manifest.apiVersion), "plugin_api_version_invalid");
  require(Number.isSafeInteger(manifest.configVersion) && manifest.configVersion > 0, "plugin_config_version_invalid");
  require(pluginTypes.has(manifest.type), "plugin_type_invalid");
  require(optionalText(manifest.description), "plugin_description_invalid");
  require(optionalText(manifest.author), "plugin_author_invalid");
  require(optionalText(manifest.entry), "plugin_entry_invalid");

  const required = new Set<string>();
  for (const requirement of manifest.requires ?? []) {
    require(nonEmpty(requirement.id), "capability_requirement_id_invalid");
    require(!required.has(requirement.id), "capability_requirement_duplicate");
    required.add(requirement.id);
    require(requirement.version === undefined || nonEmpty(requirement.version), "capability_requirement_version_invalid");
    require(requirement.optional === undefined || typeof requirement.optional === "boolean", "capability_requirement_optional_invalid");
  }

  const provided = new Set<string>();
  for (const definition of manifest.provides ?? []) {
    require(nonEmpty(definition.id), "capability_definition_id_invalid");
    require(!provided.has(definition.id), "capability_definition_duplicate");
    provided.add(definition.id);
    require(semver(definition.version), "capability_definition_version_invalid");
    require(definition.scope === "public" || definition.scope === "system", "capability_definition_scope_invalid");
    require(definition.scope !== "system" || manifest.type === "system", "capability_definition_scope_forbidden");
  }

  const namespaces = new Set<string>();
  for (const ownership of manifest.ownsEvents ?? []) {
    require(nonEmpty(ownership.namespace), "event_namespace_invalid");
    require(!namespaces.has(ownership.namespace), "event_namespace_duplicate");
    namespaces.add(ownership.namespace);
    const versions = ownership.versions ?? [];
    require(new Set(versions).size === versions.length, "event_version_duplicate");
    require(versions.every((version) => Number.isSafeInteger(version) && version > 0), "event_version_invalid");
  }

  const jobs = manifest.ownsJobs ?? [];
  require(jobs.every(nonEmpty), "job_kind_invalid");
  require(new Set(jobs).size === jobs.length, "job_kind_duplicate");
  require((manifest.permissions ?? []).every((permission) => permissions.has(permission)), "plugin_permission_invalid");
  require(new Set(manifest.permissions ?? []).size === (manifest.permissions ?? []).length, "plugin_permission_duplicate");
}

async function record(
  checks: SdkConformanceCheck[],
  name: string,
  operation: () => void | Promise<void>,
): Promise<boolean> {
  try {
    await operation();
    pass(checks, name);
    return true;
  } catch (error) {
    fail(checks, name, error);
    return false;
  }
}

function pass(checks: SdkConformanceCheck[], name: string): void {
  checks.push({ name, passed: true });
}

function fail(checks: SdkConformanceCheck[], name: string, error: unknown): void {
  checks.push({ name, passed: false, message: errorMessage(error) });
}

function report(subjectId: string, checks: readonly SdkConformanceCheck[]): SdkConformanceReport {
  return {
    subjectId,
    passed: checks.every((check) => check.passed),
    checks: checks.map((check) => ({ ...check })),
  };
}

function require(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalText(value: unknown): boolean {
  return value === undefined || nonEmpty(value);
}

function semver(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isJsonSerializable(value: unknown, active = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (active.has(value)) return false;
  active.add(value);
  const serializable = Array.isArray(value)
    ? value.every((item) => isJsonSerializable(item, active))
    : Object.entries(value).every(([key, item]) => nonEmpty(key) && isJsonSerializable(item, active));
  active.delete(value);
  return serializable;
}
