import type {
  AgentProvider,
  CapabilityDefinition,
  CapabilityDefinitionInput,
  DefinedPlugin,
  EventSchemaDefinition,
  JobHandler,
  PluginDefinition,
} from "./types.js";

/** Preserve an author definition while giving it the stable v2 plugin contract type. */
export function definePlugin<const T extends PluginDefinition>(definition: T): DefinedPlugin<T> {
  return definition as unknown as DefinedPlugin<T>;
}

/** Preserve literal capability metadata and brand its ID for runtime contracts. */
export function defineCapability<const T extends CapabilityDefinitionInput>(definition: T): T & CapabilityDefinition {
  return definition as T & CapabilityDefinition;
}

/** Preserve a serializable event payload-schema declaration without selecting a schema library. */
export function defineEventSchema<const T extends EventSchemaDefinition>(definition: T): T {
  return definition;
}

/** Preserve a provider implementation against the model-SDK-neutral Agent contract. */
export function defineAgentProvider<const T extends AgentProvider>(provider: T): T {
  return provider;
}

/** Preserve a durable handler definition; registration and retry policy belong to the runtime. */
export function defineJobHandler<const T extends JobHandler>(handler: T): T {
  return handler;
}
