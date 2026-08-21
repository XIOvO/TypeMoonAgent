import type { AgentProvider, AgentProviderAction, AgentProviderCharacterState, AgentProviderObservation, BindingQuery } from "../agent/provider.js";
import type { CapabilityDefinition, CapabilityRequirement } from "../protocol/capability.js";
import type { CommandCausation, CommandEnvelope, CommandRejection, CommandResult, ProposedEvent, ProposedJob, StateMutationProposal } from "../protocol/command.js";
import type { PluginDisposer, PluginEffect, PluginSetupContext } from "../platform/plugin-context.js";
import type {
  EventOwnership,
  PluginManifestV2,
  PluginPermission,
  PluginType,
} from "../platform/plugin-manifest.js";

export type {
  AgentProvider,
  AgentProviderAction,
  AgentProviderCharacterState,
  AgentProviderObservation,
  BindingQuery,
  CapabilityDefinition,
  CapabilityRequirement,
  CommandCausation,
  CommandEnvelope,
  CommandRejection,
  CommandResult,
  ProposedEvent,
  ProposedJob,
  StateMutationProposal,
  EventOwnership,
  PluginEffect,
  PluginDisposer,
  PluginManifestV2,
  PluginPermission,
  PluginSetupContext,
  PluginType,
};

/** Author-facing capability input; defineCapability supplies the branded public contract type. */
export type CapabilityDefinitionInput = Omit<CapabilityDefinition, "id"> & {
  readonly id: string;
};

export type CapabilityRequirementInput = Omit<CapabilityRequirement, "id"> & {
  readonly id: string;
};

/** Serializable manifest shape accepted from SDK consumers before ID branding. */
export interface PluginManifestInput {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: string;
  readonly configVersion: number;
  readonly type: PluginType;
  readonly description?: string;
  readonly author?: string;
  readonly requires?: readonly CapabilityRequirementInput[];
  readonly provides?: readonly CapabilityDefinitionInput[];
  readonly ownsEvents?: readonly EventOwnership[];
  readonly ownsJobs?: readonly string[];
  readonly permissions?: readonly PluginPermission[];
  readonly entry?: string;
}

/** Capability access available to portable plugin setup code. */
export interface CapabilityClient {
  get<T>(id: string, version?: string): T;
  has(id: string, version?: string): boolean;
  provide<T>(definition: CapabilityDefinitionInput, implementation: T): PluginDisposer;
}

export interface PluginLifecycleContext {
  effect(effect: PluginEffect, label?: string): PluginDisposer;
}

export type PluginLogLevel = "debug" | "info" | "warn" | "error";

export interface PluginLogger {
  debug(message: string, details?: Readonly<Record<string, unknown>>): void;
  info(message: string, details?: Readonly<Record<string, unknown>>): void;
  warn(message: string, details?: Readonly<Record<string, unknown>>): void;
  error(message: string, details?: Readonly<Record<string, unknown>>): void;
}

/** Host-neutral setup surface used by production adapters and createTestRuntime. */
export interface PluginRuntimeContext extends PluginSetupContext {
  readonly capabilities: CapabilityClient;
  readonly config: unknown;
  readonly lifecycle: PluginLifecycleContext;
  readonly logger: PluginLogger;
}

/** Portable plugin definition. The setup surface contains no host-framework types. */
export interface PluginDefinition {
  readonly manifest: PluginManifestInput;
  setup(context: PluginRuntimeContext): void | Promise<void>;
}

/** The same author object with the runtime's branded v2 manifest view attached at type level. */
export type DefinedPlugin<T extends PluginDefinition = PluginDefinition> = Omit<T, "manifest"> & {
  readonly manifest: T["manifest"] & PluginManifestV2;
};

/** Serializable payload-schema declaration owned by an event namespace. */
export interface EventSchemaDefinition<TSchema = unknown> {
  readonly type: string;
  readonly schemaVersion: number;
  readonly payloadSchema: TSchema;
}

/** Public, read-only view delivered to a durable job handler. */
export interface JobHandlerJob<TPayload = unknown> {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: string;
  readonly payload: TPayload;
  readonly status: "pending" | "processing" | "completed" | "dead";
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly dedupeKey: string;
  readonly availableAt: string;
  readonly leasedAt?: string;
  readonly leaseOwner?: string;
  readonly completedAt?: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly ownerPlugin?: string;
  readonly ownerVersion?: string;
  readonly payloadVersion?: number;
}

/** A handler describes one manifest-owned job kind; queue lifecycle stays with the runtime. */
export interface JobHandler<TPayload = unknown> {
  readonly kind: string;
  readonly payloadVersion: number;
  readonly payloadSchema?: unknown;
  handle(job: JobHandlerJob<TPayload>): void | Promise<void>;
}

export interface TestCapabilityProvider<T = unknown> {
  readonly definition: CapabilityDefinitionInput;
  readonly implementation: T;
  readonly pluginId?: string;
}

export interface TestPluginEntry {
  readonly plugin: PluginDefinition;
  readonly config?: unknown;
  readonly disabled?: boolean;
}

export interface CreateTestRuntimeOptions {
  readonly plugins?: readonly TestPluginEntry[];
  readonly capabilities?: readonly TestCapabilityProvider[];
}

export interface TestCapabilityDescriptor extends CapabilityDefinitionInput {
  readonly pluginId: string;
}

export interface TestLogEntry {
  readonly pluginId: string;
  readonly level: PluginLogLevel;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface TestRuntime {
  getCapability<T>(id: string, version?: string): T;
  hasCapability(id: string, version?: string): boolean;
  listCapabilities(): readonly TestCapabilityDescriptor[];
  listPluginIds(): readonly string[];
  logs(): readonly TestLogEntry[];
  dispose(): Promise<void>;
}
