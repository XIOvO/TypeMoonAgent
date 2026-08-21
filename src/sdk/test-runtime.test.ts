import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestRuntime,
  defineCapability,
  definePlugin,
  type PluginRuntimeContext,
} from "./index.js";

const GREETING = defineCapability({
  id: "example.greeting",
  version: "1.2.0",
  scope: "public",
});

const EVENT_STORE = defineCapability({
  id: "world.eventStore",
  version: "1.0.0",
  scope: "public",
});

test("createTestRuntime orders setup, injects capabilities and config, then cleans up in reverse", async () => {
  const calls: string[] = [];
  const appended: string[] = [];

  const consumer = definePlugin({
    manifest: {
      id: "feature.consumer",
      version: "1.0.0",
      apiVersion: "0.3.0",
      configVersion: 1,
      type: "feature",
      requires: [
        { id: GREETING.id, version: "^1.0.0" },
        { id: EVENT_STORE.id, version: "1.0.0" },
      ],
    },
    async setup(context: PluginRuntimeContext) {
      calls.push("consumer:setup");
      const greeting = context.capabilities.get<{ greet(name: string): string }>(GREETING.id);
      const events = context.capabilities.get<{ append(value: string): Promise<void> }>(EVENT_STORE.id);
      await events.append(greeting.greet((context.config as { name: string }).name));
      context.logger.info("consumer ready", { capability: GREETING.id });
      context.lifecycle.effect(() => () => { calls.push("consumer:cleanup"); });
    },
  });

  const provider = definePlugin({
    manifest: {
      id: "feature.provider",
      version: "1.0.0",
      apiVersion: "0.3.0",
      configVersion: 1,
      type: "feature",
      provides: [GREETING],
    },
    setup(context: PluginRuntimeContext) {
      calls.push("provider:setup");
      context.capabilities.provide(GREETING, { greet: (name: string) => `Hello, ${name}!` });
      context.effect(() => () => { calls.push("provider:cleanup"); });
    },
  });

  const runtime = await createTestRuntime({
    plugins: [
      { plugin: consumer, config: { name: "Mash" } },
      { plugin: provider },
    ],
    capabilities: [{
      definition: EVENT_STORE,
      implementation: { async append(value: string) { appended.push(value); } },
      pluginId: "test.persistence",
    }],
  });

  assert.deepEqual(runtime.listPluginIds(), ["feature.provider", "feature.consumer"]);
  assert.deepEqual(calls, ["provider:setup", "consumer:setup"]);
  assert.deepEqual(appended, ["Hello, Mash!"]);
  assert.equal(runtime.getCapability<{ greet(name: string): string }>(GREETING.id).greet("Ritsuka"), "Hello, Ritsuka!");
  assert.equal(runtime.hasCapability(EVENT_STORE.id, "^1.0.0"), true);
  assert.deepEqual(runtime.listCapabilities().map(({ id, pluginId }) => ({ id, pluginId })), [
    { id: EVENT_STORE.id, pluginId: "test.persistence" },
    { id: GREETING.id, pluginId: "feature.provider" },
  ]);
  assert.deepEqual(runtime.logs(), [{
    pluginId: "feature.consumer",
    level: "info",
    message: "consumer ready",
    details: { capability: GREETING.id },
  }]);

  await runtime.dispose();
  assert.deepEqual(calls, [
    "provider:setup",
    "consumer:setup",
    "consumer:cleanup",
    "provider:cleanup",
  ]);
  assert.throws(() => runtime.getCapability(GREETING.id), /test_runtime_disposed/);
  await runtime.dispose();
});

test("createTestRuntime rejects missing, incompatible and forbidden requirements before setup", async () => {
  let setupCalls = 0;
  const plugin = (requirement: { id: string; version?: string }) => definePlugin({
    manifest: {
      id: "feature.requirement",
      version: "1.0.0",
      apiVersion: "0.3.0",
      configVersion: 1,
      type: "feature",
      requires: [requirement],
    },
    setup() { setupCalls += 1; },
  });

  await assert.rejects(createTestRuntime({ plugins: [{ plugin: plugin({ id: "missing" }) }] }), /capability\.not_found/);
  await assert.rejects(createTestRuntime({
    plugins: [{ plugin: plugin({ id: GREETING.id, version: "^2.0.0" }) }],
    capabilities: [{ definition: GREETING, implementation: {} }],
  }), /capability\.version_mismatch/);
  await assert.rejects(createTestRuntime({
    plugins: [{ plugin: plugin({ id: "system.secret", version: "1.0.0" }) }],
    capabilities: [{
      definition: { id: "system.secret", version: "1.0.0", scope: "system" },
      implementation: {},
    }],
  }), /plugin\.permission_denied/);
  assert.equal(setupCalls, 0);
});

test("createTestRuntime rolls back effects and providers when setup fails", async () => {
  const cleanup: string[] = [];
  const provider = definePlugin({
    manifest: {
      id: "feature.rollback-provider",
      version: "1.0.0",
      apiVersion: "0.3.0",
      configVersion: 1,
      type: "feature",
      provides: [GREETING],
    },
    setup(context: PluginRuntimeContext) {
      context.capabilities.provide(GREETING, {});
      context.effect(() => () => { cleanup.push("provider"); });
    },
  });
  const failing = definePlugin({
    manifest: {
      id: "feature.rollback-consumer",
      version: "1.0.0",
      apiVersion: "0.3.0",
      configVersion: 1,
      type: "feature",
      requires: [{ id: GREETING.id }],
    },
    setup(context: PluginRuntimeContext) {
      context.effect(() => () => { cleanup.push("consumer"); });
      throw new Error("setup_failed");
    },
  });

  await assert.rejects(createTestRuntime({
    plugins: [{ plugin: failing }, { plugin: provider }],
  }), /setup_failed/);
  assert.deepEqual(cleanup, ["consumer", "provider"]);

  const incomplete = definePlugin({
    manifest: {
      id: "feature.incomplete",
      version: "1.0.0",
      apiVersion: "0.3.0",
      configVersion: 1,
      type: "feature",
      provides: [GREETING],
    },
    setup(context: PluginRuntimeContext) {
      context.effect(() => () => { cleanup.push("incomplete"); });
    },
  });
  await assert.rejects(createTestRuntime({ plugins: [{ plugin: incomplete }] }), /plugin_capability_not_provided/);
  assert.deepEqual(cleanup, ["consumer", "provider", "incomplete"]);
});


test("createTestRuntime rejects duplicate providers and dependency cycles before setup", async () => {
  const first = defineCapability({ id: "cycle.first", version: "1.0.0", scope: "public" });
  const second = defineCapability({ id: "cycle.second", version: "1.0.0", scope: "public" });
  let setupCalls = 0;
  const one = definePlugin({
    manifest: {
      id: "feature.cycle-one",
      version: "1.0.0",
      apiVersion: "0.3.0",
      configVersion: 1,
      type: "feature",
      requires: [{ id: second.id }],
      provides: [first],
    },
    setup(context: PluginRuntimeContext) {
      setupCalls += 1;
      context.capabilities.provide(first, {});
    },
  });
  const two = definePlugin({
    manifest: {
      id: "feature.cycle-two",
      version: "1.0.0",
      apiVersion: "0.3.0",
      configVersion: 1,
      type: "feature",
      requires: [{ id: first.id }],
      provides: [second],
    },
    setup(context: PluginRuntimeContext) {
      setupCalls += 1;
      context.capabilities.provide(second, {});
    },
  });

  await assert.rejects(createTestRuntime({
    plugins: [{ plugin: one }, { plugin: two }],
  }), /plugin\.dependency_cycle/);
  await assert.rejects(createTestRuntime({
    capabilities: [
      { definition: first, implementation: {}, pluginId: "test.one" },
      { definition: first, implementation: {}, pluginId: "test.two" },
    ],
  }), /capability_duplicate_provider/);
  assert.equal(setupCalls, 0);
});
