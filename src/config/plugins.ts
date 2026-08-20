import type { PluginId } from "../protocol/ids.js";
import type { DiscoveredLocalPlugin } from "../platform/local-plugin-host.js";

export interface PluginProfileEntry {
  id: PluginId;
  /** Exact plugin version selected by this profile, when a version is pinned. */
  version?: string;
  disabled?: boolean;
  config?: unknown;
}

export interface PluginProfile {
  id: string;
  plugins: readonly PluginProfileEntry[];
}

export interface ComposedLocalPlugin {
  plugin: DiscoveredLocalPlugin;
  disabled: boolean;
  config?: unknown;
}

export interface LocalPluginComposition {
  profile: PluginProfile;
  plugins: readonly ComposedLocalPlugin[];
}

/** Parses a JSON profile without coupling profile selection to a host runtime. */
export function parsePluginProfile(source: string): PluginProfile {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("plugin_profile_invalid");
  }
  if (!value || typeof value !== "object") throw new Error("plugin_profile_invalid");
  const profile = value as { id?: unknown; plugins?: unknown };
  if (typeof profile.id !== "string" || !profile.id || !Array.isArray(profile.plugins)) throw new Error("plugin_profile_invalid");

  const ids = new Set<string>();
  const plugins = profile.plugins.map((entry): PluginProfileEntry => {
    if (!entry || typeof entry !== "object") throw new Error("plugin_profile_invalid");
    const candidate = entry as { id?: unknown; version?: unknown; disabled?: unknown; config?: unknown };
    if (typeof candidate.id !== "string" || !candidate.id) throw new Error("plugin_profile_invalid");
    if (candidate.version !== undefined && (typeof candidate.version !== "string" || !candidate.version)) throw new Error("plugin_profile_invalid");
    if (candidate.disabled !== undefined && typeof candidate.disabled !== "boolean") throw new Error("plugin_profile_invalid");
    if (ids.has(candidate.id)) throw new Error("plugin_profile_duplicate_plugin");
    ids.add(candidate.id);
    return {
      id: candidate.id as PluginId,
      ...(candidate.version === undefined ? {} : { version: candidate.version }),
      ...(candidate.disabled === undefined ? {} : { disabled: candidate.disabled }),
      ...(candidate.config === undefined ? {} : { config: candidate.config }),
    };
  });
  return { id: profile.id, plugins };
}

/** Selects explicit profile entries from already-discovered trusted local plugins. */
export function composeLocalPluginProfile(profile: PluginProfile, discovered: readonly DiscoveredLocalPlugin[]): LocalPluginComposition {
  const byId = new Map<PluginId, DiscoveredLocalPlugin>();
  for (const plugin of discovered) {
    if (byId.has(plugin.manifest.id)) throw new Error("plugin_profile_ambiguous_plugin");
    byId.set(plugin.manifest.id, plugin);
  }
  return {
    profile,
    plugins: profile.plugins.map((entry) => {
      const plugin = byId.get(entry.id);
      if (!plugin) throw new Error("plugin_profile_plugin_not_found");
      if (entry.version !== undefined && entry.version !== plugin.manifest.version) throw new Error("plugin_profile_version_mismatch");
      return { plugin, disabled: entry.disabled ?? false, ...(entry.config === undefined ? {} : { config: entry.config }) };
    }),
  };
}

/** Parses and composes one profile; mounting remains the adapter's responsibility. */
export function loadLocalPluginComposition(source: string, discovered: readonly DiscoveredLocalPlugin[]): LocalPluginComposition {
  return composeLocalPluginProfile(parsePluginProfile(source), discovered);
}
