export {
  defineAgentProvider,
  defineCapability,
  defineEventSchema,
  defineJobHandler,
  definePlugin,
} from "./definitions.js";

export { createTestRuntime } from "./test-runtime.js";

export {
  runAgentProviderConformance,
  runPluginConformance,
} from "./conformance.js";

export {
  COMBAT_RESOLVE_CAPABILITY,
  COMBAT_RESOLVE_CAPABILITY_DEFINITION,
  COMBAT_RESOLVE_COMMAND_SCHEMA,
  isCombatResolveCommand,
} from "../protocol/combat-commands.js";

export type {
  AgentProvider,
  AgentProviderAction,
  AgentProviderCharacterState,
  AgentProviderObservation,
  BindingQuery,
  CapabilityClient,
  CapabilityDefinition,
  CapabilityDefinitionInput,
  CapabilityRequirement,
  CapabilityRequirementInput,
  CommandCausation,
  CommandEnvelope,
  CommandRejection,
  CommandResult,
  CreateTestRuntimeOptions,
  DefinedPlugin,
  EventOwnership,
  EventSchemaDefinition,
  JobHandler,
  JobHandlerJob,
  PluginDefinition,
  PluginDisposer,
  PluginEffect,
  PluginLifecycleContext,
  PluginLogger,
  PluginLogLevel,
  PluginManifestInput,
  PluginManifestV2,
  PluginPermission,
  PluginRuntimeContext,
  PluginSetupContext,
  PluginType,
  ProposedEvent,
  ProposedJob,
  StateMutationProposal,
  TestCapabilityDescriptor,
  TestCapabilityProvider,
  TestLogEntry,
  TestPluginEntry,
  TestRuntime,
} from "./types.js";

export type {
  PluginConformanceProbe,
  RunAgentProviderConformanceOptions,
  RunPluginConformanceOptions,
  SdkConformanceCheck,
  SdkConformanceReport,
} from "./conformance.js";

export type {
  CombatActionCommand,
  CombatActionIntent,
  CombatResolveCommand,
  CombatResolveCommandPayload,
} from "../protocol/combat-commands.js";
