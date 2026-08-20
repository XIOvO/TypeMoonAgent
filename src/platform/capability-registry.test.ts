import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry } from "./capability-registry.js";
import type { CapabilityId, PluginId } from "../protocol/ids.js";

const capabilityId = "world.navigation" as CapabilityId;
const pluginId = "system.navigation" as PluginId;

test("capability registry registers, resolves, lists, and unregisters providers", () => {
  const registry = new CapabilityRegistry();
  registry.register(pluginId, { definition: { id: capabilityId, version: "1.0.0", scope: "public" }, implementation: { findRoute: () => [] } });
  assert.equal(typeof registry.resolve<{ findRoute(): unknown[] }>({ id: capabilityId, version: "^1.0.0" }).findRoute, "function");
  assert.deepEqual(registry.list(), [{ id: capabilityId, version: "1.0.0", scope: "public", pluginId }]);
  registry.unregister(pluginId, capabilityId);
  assert.equal(registry.has({ id: capabilityId }), false);
});

test("capability registry rejects duplicate, missing, incompatible, and forbidden providers", () => {
  const registry = new CapabilityRegistry();
  registry.register(pluginId, { definition: { id: capabilityId, version: "1.0.0", scope: "system" }, implementation: {} });
  assert.throws(() => registry.register(pluginId, { definition: { id: capabilityId, version: "1.0.0", scope: "public" }, implementation: {} }), /capability_duplicate_provider/);
  assert.throws(() => registry.resolve({ id: "missing" as CapabilityId }), /capability.not_found/);
  assert.throws(() => registry.resolve({ id: capabilityId, version: "^2.0.0" }, "system"), /capability.version_mismatch/);
  assert.throws(() => registry.resolve({ id: capabilityId }), /plugin.permission_denied/);
});
