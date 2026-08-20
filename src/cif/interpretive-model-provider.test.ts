import assert from "node:assert/strict";
import test from "node:test";
import { ReaderInterpretiveModelProvider } from "./interpretive-model-provider.js";

test("InterpretiveModelProvider exposes only reader-selected latest live models", async () => {
  const provider = new ReaderInterpretiveModelProvider({ listInterpretiveModels: () => [{ id: "new", sessionId: "demo", characterId: "mash", kind: "social", content: "Current model", activation: 0.8, supportingEvidenceIds: ["e2"], opposingEvidenceIds: [], version: 2 }] });
  const models = await provider.getModels({ sessionId: "demo", characterId: "mash" });
  assert.deepEqual(models.map(({ id, version }) => ({ id, version })), [{ id: "new", version: 2 }]);
});
