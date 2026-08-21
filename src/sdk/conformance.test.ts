import assert from "node:assert/strict";
import test from "node:test";
import {
  defineAgentProvider,
  defineCapability,
  definePlugin,
  runAgentProviderConformance,
  runPluginConformance,
} from "./index.js";
import type {
  AgentProviderObservation,
  PluginRuntimeContext,
} from "./index.js";

const SUBJECT_CAPABILITY = defineCapability({
  id: "example.conformance",
  version: "1.0.0",
  scope: "public",
});

function conformingPlugin(calls: string[]) {
  return definePlugin({
    manifest: {
      id: "example.conformance-plugin",
      version: "1.0.0",
      apiVersion: "0.3",
      configVersion: 1,
      type: "feature",
      provides: [SUBJECT_CAPABILITY],
      ownsEvents: [{ namespace: "example.conformance", versions: [1] }],
    },
    setup(context: PluginRuntimeContext) {
      calls.push("setup");
      context.capabilities.provide(SUBJECT_CAPABILITY, {
        execute(value: string) {
          return value.toUpperCase();
        },
      });
      context.lifecycle.effect(() => () => {
        calls.push("cleanup");
      });
    },
  });
}

test("plugin conformance covers manifest, protocol, lifecycle, cleanup, and closed state", async () => {
  const calls: string[] = [];
  const result = await runPluginConformance({
    plugin: conformingPlugin(calls),
    probes: [{
      name: "uppercase",
      run(runtime) {
        const subject = runtime.getCapability<{ execute(value: string): string }>(SUBJECT_CAPABILITY.id);
        assert.equal(subject.execute("mash"), "MASH");
      },
    }],
    verifyCleanup() {
      assert.deepEqual(calls, ["setup", "cleanup"]);
    },
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.checks.map(({ name, passed }) => ({ name, passed })), [
    { name: "manifest.serializable", passed: true },
    { name: "manifest.contract", passed: true },
    { name: "lifecycle.setup", passed: true },
    { name: "protocol.uppercase", passed: true },
    { name: "lifecycle.dispose", passed: true },
    { name: "cleanup.verify", passed: true },
    { name: "lifecycle.closed", passed: true },
  ]);
});

test("plugin conformance rejects an invalid manifest before setup", async () => {
  let setupCalls = 0;
  const plugin = definePlugin({
    manifest: {
      id: "example.invalid-plugin",
      version: "not-semver",
      apiVersion: "0.3",
      configVersion: 1,
      type: "feature",
    },
    setup() {
      setupCalls += 1;
    },
  });

  const result = await runPluginConformance({ plugin });
  assert.equal(result.passed, false);
  assert.equal(result.checks.find((check) => check.name === "manifest.contract")?.message, "plugin_version_invalid");
  assert.equal(setupCalls, 0);
});

test("plugin conformance observes rollback cleanup after setup failure", async () => {
  const calls: string[] = [];
  const plugin = definePlugin({
    manifest: {
      id: "example.rollback-plugin",
      version: "1.0.0",
      apiVersion: "0.3",
      configVersion: 1,
      type: "feature",
    },
    setup(context: PluginRuntimeContext) {
      context.effect(() => () => {
        calls.push("rollback");
      });
      throw new Error("setup_failed");
    },
  });

  const result = await runPluginConformance({
    plugin,
    verifyCleanup() {
      assert.deepEqual(calls, ["rollback"]);
    },
  });
  assert.equal(result.passed, false);
  assert.equal(result.checks.find((check) => check.name === "lifecycle.setup")?.message, "setup_failed");
  assert.equal(result.checks.find((check) => check.name === "cleanup.rollback")?.passed, true);
});

test("protocol failures are reported without skipping lifecycle cleanup", async () => {
  const calls: string[] = [];
  const result = await runPluginConformance({
    plugin: conformingPlugin(calls),
    probes: [{
      name: "intentional-failure",
      run() {
        throw new Error("protocol_mismatch");
      },
    }],
    verifyCleanup() {
      assert.deepEqual(calls, ["setup", "cleanup"]);
    },
  });

  assert.equal(result.passed, false);
  assert.equal(result.checks.find((check) => check.name === "protocol.intentional-failure")?.message, "protocol_mismatch");
  assert.equal(result.checks.find((check) => check.name === "cleanup.verify")?.passed, true);
  assert.equal(result.checks.find((check) => check.name === "lifecycle.closed")?.passed, true);
});

test("agent provider conformance verifies binding, action protocol, serialization, and determinism", async () => {
  const provider = defineAgentProvider({
    id: "example.conformance-agent",
    supports(query) {
      return query.agentProfile === "rule";
    },
    async run(observation: AgentProviderObservation) {
      return {
        id: "agent:" + observation.id,
        sessionId: observation.sessionId,
        actorId: observation.recipientId,
        observationId: observation.id,
        utterance: "Ready.",
        requests: [],
      };
    },
  });
  const observation: AgentProviderObservation = {
    id: "observation-1",
    sessionId: "session-1",
    recipientId: "companion-1",
    triggerActionId: "action-1",
    scene: { id: "room-1", visibleEntityIds: ["companion-1"] },
    incomingAction: { actorId: "player-1", type: "dialogue" },
    selfState: { id: "companion-1", locationId: "room-1", mood: "calm" },
    constraints: [],
  };

  const result = await runAgentProviderConformance({
    provider,
    matchingQuery: { characterId: "companion-1", agentProfile: "rule" },
    nonMatchingQuery: { characterId: "companion-1", agentProfile: "pi" },
    observation,
    verifyAction(action) {
      assert.deepEqual(action.requests, []);
    },
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.checks.map((check) => check.name), [
    "provider.identity",
    "binding.match",
    "binding.reject",
    "action.run",
    "action.protocol",
    "action.serializable",
    "action.deterministic",
    "protocol.action",
  ]);
});
