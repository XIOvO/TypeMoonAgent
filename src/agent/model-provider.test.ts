import assert from "node:assert/strict";
import test from "node:test";
import type { ModelGenerationRequest, ModelProvider } from "./model-provider.js";

test("ModelProvider is independently mockable without exposing a model SDK", async () => {
  const request: ModelGenerationRequest = { modelId: "reference", prompt: "Reply briefly.", metadata: { purpose: "agent" } };
  const provider: ModelProvider = {
    id: "test.model",
    generate: async (input) => ({ modelId: input.modelId, text: "Acknowledged.", finishReason: "stop" }),
  };

  assert.deepEqual(await provider.generate(request), { modelId: "reference", text: "Acknowledged.", finishReason: "stop" });
});
