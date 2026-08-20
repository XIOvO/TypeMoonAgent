import type { CapabilityDefinition, CapabilityProvider, CapabilityRequirement } from "../protocol/capability.js";
import type { CapabilityId, PluginId } from "../protocol/ids.js";
import { isCapabilityVersionCompatible } from "./capability-version.js";

export interface CapabilityDescriptor extends CapabilityDefinition { pluginId: PluginId; }

export class CapabilityRegistry {
  private readonly providers = new Map<CapabilityId, { pluginId: PluginId; provider: CapabilityProvider }>();

  public register(pluginId: PluginId, provider: CapabilityProvider): void {
    if (this.providers.has(provider.definition.id)) throw new Error("capability_duplicate_provider");
    this.providers.set(provider.definition.id, { pluginId, provider });
  }

  public unregister(pluginId: PluginId, capabilityId: CapabilityId): void {
    const entry = this.providers.get(capabilityId);
    if (entry?.pluginId === pluginId) this.providers.delete(capabilityId);
  }

  public resolve<T>(requirement: CapabilityRequirement, requesterScope: "public" | "system" = "public"): T {
    const entry = this.providers.get(requirement.id);
    if (!entry) throw new Error("capability.not_found");
    if (!isCapabilityVersionCompatible(entry.provider.definition.version, requirement.version)) throw new Error("capability.version_mismatch");
    if (entry.provider.definition.scope === "system" && requesterScope !== "system") throw new Error("plugin.permission_denied");
    return entry.provider.implementation as T;
  }

  public has(requirement: CapabilityRequirement, requesterScope: "public" | "system" = "public"): boolean {
    try { this.resolve(requirement, requesterScope); return true; } catch { return false; }
  }

  public list(): readonly CapabilityDescriptor[] {
    return [...this.providers.values()].map(({ pluginId, provider }) => ({ ...provider.definition, pluginId }));
  }
}
