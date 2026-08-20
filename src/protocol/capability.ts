import type { CapabilityId } from "./ids.js";

/** Serializable public description of a capability supplied by a plugin. */
export interface CapabilityDefinition {
  id: CapabilityId;
  version: string;
  scope: CapabilityScope;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export type CapabilityScope = "public" | "system";

/** Serializable dependency declaration; version interpretation belongs to E03-02. */
export interface CapabilityRequirement {
  id: CapabilityId;
  version?: string;
  optional?: boolean;
}

/** Runtime binding, deliberately separate from the serializable definition. */
export interface CapabilityProvider<T = unknown> {
  definition: CapabilityDefinition;
  implementation: T;
}
