import type { CapabilityDefinition, CapabilityRequirement } from "../protocol/capability.js";
import type { CapabilityId, PluginId } from "../protocol/ids.js";

export interface PluginManifestV2 {
  id: PluginId;
  version: string;
  apiVersion: string;
  configVersion: number;
  type: PluginType;
  description?: string;
  author?: string;
  requires?: CapabilityRequirement[];
  provides?: CapabilityDefinition[];
  ownsEvents?: EventOwnership[];
  ownsJobs?: string[];
  permissions?: PluginPermission[];
  entry?: string;
}

export type PluginType = "system" | "feature" | "world" | "adapter" | "provider";
export interface EventOwnership { namespace: string; versions?: number[]; }
export type PluginPermission = "world.read" | "character.read" | "events.read" | "jobs.enqueue" | "model.invoke" | "network.access" | "filesystem.access";

/** Compatible v1 read shape; source data is never rewritten by this adapter. */
export interface PluginManifestV1 {
  id: string;
  version: string;
  configVersion: number;
  requires?: readonly string[];
  provides?: readonly { id: string; serviceKey: string; scope?: "public" | "system" }[];
  ownsEvents?: readonly string[];
  ownsJobs?: readonly string[];
}

export function upgradePluginManifestV1(manifest: PluginManifestV1): PluginManifestV2 {
  if (!manifest.id.trim() || !manifest.version.trim() || !Number.isSafeInteger(manifest.configVersion) || manifest.configVersion < 1) {
    throw new Error("plugin_manifest_invalid");
  }
  return {
    id: manifest.id as PluginId,
    version: manifest.version,
    apiVersion: "0.3.0",
    configVersion: manifest.configVersion,
    type: manifest.id.startsWith("system.") ? "system" : "feature",
    ...(manifest.requires ? { requires: manifest.requires.map((id) => ({ id: id as CapabilityId })) } : {}),
    ...(manifest.provides ? { provides: manifest.provides.map((capability) => ({ id: capability.id as CapabilityId, version: manifest.version, scope: capability.scope ?? "public" })) } : {}),
    ...(manifest.ownsEvents ? { ownsEvents: manifest.ownsEvents.map((namespace) => ({ namespace })) } : {}),
    ...(manifest.ownsJobs ? { ownsJobs: [...manifest.ownsJobs] } : {}),
    permissions: [],
  };
}
