import assert from "node:assert/strict";
import test from "node:test";
import { loadLocalPluginComposition, parsePluginProfile } from "./plugins.js";
import type { DiscoveredLocalPlugin } from "../platform/local-plugin-host.js";
import type { PluginId } from "../protocol/ids.js";

const discovered: readonly DiscoveredLocalPlugin[] = [{
  rootPath: "C:/trusted",
  directoryPath: "C:/trusted/example",
  manifestPath: "C:/trusted/example/plugin.json",
  manifest: { id: "feature.example" as PluginId, version: "1.2.0", apiVersion: "0.3.0", configVersion: 1, type: "feature" },
}];

test("plugin profile composes disabled, configured, version-pinned local plugins", () => {
  const composition = loadLocalPluginComposition(JSON.stringify({
    id: "local-dev",
    plugins: [{ id: "feature.example", version: "1.2.0", disabled: true, config: { greeting: "hello" } }],
  }), discovered);
  assert.equal(composition.profile.id, "local-dev");
  assert.deepEqual(composition.plugins.map(({ plugin, disabled, config }) => ({ id: plugin.manifest.id, disabled, config })), [
    { id: "feature.example", disabled: true, config: { greeting: "hello" } },
  ]);
});

test("plugin profile rejects malformed, duplicate, unavailable, and mismatched selections", () => {
  assert.throws(() => parsePluginProfile("not-json"), /plugin_profile_invalid/);
  assert.throws(() => parsePluginProfile(JSON.stringify({ id: "test", plugins: [{ id: "feature.example" }, { id: "feature.example" }] })), /plugin_profile_duplicate_plugin/);
  assert.throws(() => loadLocalPluginComposition(JSON.stringify({ id: "test", plugins: [{ id: "feature.missing" }] }), discovered), /plugin_profile_plugin_not_found/);
  assert.throws(() => loadLocalPluginComposition(JSON.stringify({ id: "test", plugins: [{ id: "feature.example", version: "2.0.0" }] }), discovered), /plugin_profile_version_mismatch/);
});
