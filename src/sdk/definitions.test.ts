import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestRuntime,
  defineAgentProvider,
  defineCapability,
  defineEventSchema,
  defineJobHandler,
  definePlugin,
  type CapabilityDefinition,
  type JobHandler,
  type PluginManifestV2,
  type PluginRuntimeContext,
} from "./index.js";

test("SDK definition helpers preserve author objects and stable contract types", async () => {
  const capabilityInput = {
    id: "example.greeting",
    version: "1.0.0",
    scope: "public" as const,
    inputSchema: { type: "object", required: ["name"] },
    outputSchema: { type: "object", required: ["message"] },
  };
  const capability = defineCapability(capabilityInput);
  const capabilityContract: CapabilityDefinition = capability;

  const eventSchemaInput = {
    type: "example.greeting.sent",
    schemaVersion: 1,
    payloadSchema: { type: "object", required: ["message"] },
  };
  const eventSchema = defineEventSchema(eventSchemaInput);

  const providerInput = {
    id: "agent.example",
    supports: (query: { agentProfile?: string }) => query.agentProfile === "example",
    async run(observation: { id: string; sessionId: string; recipientId: string }) {
      return {
        id: `agent:${observation.id}`,
        sessionId: observation.sessionId,
        actorId: observation.recipientId,
        observationId: observation.id,
        requests: [],
      };
    },
  };
  const provider = defineAgentProvider(providerInput);

  const jobHandlerInput: JobHandler<{ name: string }> = {
    kind: "example.greeting",
    payloadVersion: 1,
    handle(job) {
      assert.equal(job.payload.name, "Mash");
    },
  };
  const jobHandler = defineJobHandler(jobHandlerInput);

  let disposed = false;
  const pluginInput = {
    manifest: {
      id: "feature.example-greeting",
      version: "1.0.0",
      apiVersion: "0.3.0",
      configVersion: 1,
      type: "feature" as const,
      provides: [capability],
      ownsEvents: [{ namespace: "example.greeting", versions: [1] }],
      ownsJobs: [jobHandler.kind],
    },
    setup(context: PluginRuntimeContext) {
      context.capabilities.provide(capability, { greet: () => "hello" });
      context.effect(() => () => { disposed = true; });
    },
  };
  const plugin = definePlugin(pluginInput);
  const manifestContract: PluginManifestV2 = plugin.manifest;

  assert.strictEqual(capability, capabilityInput);
  assert.strictEqual(eventSchema, eventSchemaInput);
  assert.strictEqual(provider, providerInput);
  assert.strictEqual(jobHandler, jobHandlerInput);
  assert.strictEqual(plugin, pluginInput);
  assert.equal(capabilityContract.id, "example.greeting");
  assert.equal(manifestContract.id, "feature.example-greeting");
  assert.equal((await provider.run({ id: "obs", sessionId: "demo", recipientId: "mash" })).actorId, "mash");

  const runtime = await createTestRuntime({ plugins: [{ plugin }] });
  assert.equal(runtime.getCapability<{ greet(): string }>(capability.id).greet(), "hello");
  await runtime.dispose();
  assert.equal(disposed, true);
});
