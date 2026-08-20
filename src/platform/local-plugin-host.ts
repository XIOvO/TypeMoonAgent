import { readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { PluginManifestV2, PluginType } from "./plugin-manifest.js";

const PLUGIN_TYPES: readonly PluginType[] = ["system", "feature", "world", "adapter", "provider"];

export interface LocalPluginHostOptions {
  /** Explicitly trusted absolute directories; remote locations are unsupported. */
  trustedRoots: readonly string[];
  manifestFileName?: string;
}

export interface DiscoveredLocalPlugin {
  rootPath: string;
  directoryPath: string;
  manifestPath: string;
  manifest: PluginManifestV2;
}

/**
 * Discovers manifest-only local plugins below explicitly trusted roots.
 *
 * Loading code, registering providers, and mounting a lifecycle are owned by
 * later composition and Cordis adapter stages.
 */
export class LocalPluginHost {
  private readonly roots: readonly string[];
  private readonly manifestFileName: string;

  public constructor(options: LocalPluginHostOptions) {
    if (options.trustedRoots.length === 0) throw new Error("local_plugin_root_required");
    this.roots = [...new Set(options.trustedRoots.map((root) => {
      if (!isAbsolute(root)) throw new Error("local_plugin_root_must_be_absolute");
      return resolve(root);
    }))];
    this.manifestFileName = options.manifestFileName ?? "plugin.json";
    if (!this.manifestFileName || this.manifestFileName.includes("/") || this.manifestFileName.includes("\\")) {
      throw new Error("local_plugin_manifest_name_invalid");
    }
  }

  public async discover(): Promise<readonly DiscoveredLocalPlugin[]> {
    const plugins: DiscoveredLocalPlugin[] = [];
    for (const root of this.roots) plugins.push(...await this.discoverRoot(root));
    return plugins;
  }

  private async discoverRoot(root: string): Promise<DiscoveredLocalPlugin[]> {
    const realRoot = await realpath(root);
    const entries = await readdir(realRoot, { withFileTypes: true });
    const plugins: DiscoveredLocalPlugin[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directoryPath = resolve(realRoot, entry.name);
      const manifestPath = resolve(directoryPath, this.manifestFileName);
      const realManifest = await realpath(manifestPath).catch(() => undefined);
      if (!realManifest) continue;
      if (!isWithin(realRoot, realManifest)) throw new Error("local_plugin_path_untrusted");
      const manifest = parseLocalPluginManifest(await readFile(realManifest, "utf8"));
      plugins.push({ rootPath: realRoot, directoryPath, manifestPath: realManifest, manifest });
    }
    return plugins;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function parseLocalPluginManifest(source: string): PluginManifestV2 {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("local_plugin_manifest_invalid");
  }
  if (!value || typeof value !== "object") throw new Error("local_plugin_manifest_invalid");
  const manifest = value as Partial<PluginManifestV2>;
  if (
    typeof manifest.id !== "string" || !manifest.id ||
    typeof manifest.version !== "string" || !manifest.version ||
    typeof manifest.apiVersion !== "string" || !manifest.apiVersion ||
    typeof manifest.configVersion !== "number" || !Number.isSafeInteger(manifest.configVersion) || manifest.configVersion < 1 ||
    !PLUGIN_TYPES.includes(manifest.type as PluginType)
  ) throw new Error("local_plugin_manifest_invalid");
  return manifest as PluginManifestV2;
}
