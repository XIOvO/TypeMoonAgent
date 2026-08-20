import assert from "node:assert/strict";
import test from "node:test";
import { upgradePluginManifestV1 } from "./plugin-manifest.js";

test("v1 plugin manifests upgrade to a serializable v2 view", () => {
  const v2 = upgradePluginManifestV1({
    id: "system.world", version: "1.4.0", configVersion: 2, requires: ["world.state"],
    provides: [{ id: "world.jobs", serviceKey: "jobs", scope: "system" }], ownsEvents: ["world"], ownsJobs: ["world.tick"],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(v2)), {
    id: "system.world", version: "1.4.0", apiVersion: "0.3.0", configVersion: 2, type: "system",
    requires: [{ id: "world.state" }], provides: [{ id: "world.jobs", version: "1.4.0", scope: "system" }],
    ownsEvents: [{ namespace: "world" }], ownsJobs: ["world.tick"], permissions: [],
  });
});

test("v1 manifest upgrades reject invalid identity or config versions", () => {
  assert.throws(() => upgradePluginManifestV1({ id: "", version: "1.0.0", configVersion: 1 }), /plugin_manifest_invalid/);
  assert.throws(() => upgradePluginManifestV1({ id: "feature.test", version: "", configVersion: 1 }), /plugin_manifest_invalid/);
  assert.throws(() => upgradePluginManifestV1({ id: "feature.test", version: "1.0.0", configVersion: 0 }), /plugin_manifest_invalid/);
});
