import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilityDefinition, CapabilityRequirement } from "./capability.js";
import type { CapabilityId } from "./ids.js";

const id = "world.navigation" as CapabilityId;
const definition: CapabilityDefinition = {
  id, version: "1.2.0", scope: "public", description: "Finds an authorized world route.",
  inputSchema: { type: "object", required: ["from", "to"] }, outputSchema: { type: "object" },
};
const requirement: CapabilityRequirement = { id, version: "^1.0.0", optional: false };

test("capability definitions and requirements preserve id, version, scope, and schemas in JSON", () => {
  assert.deepEqual(JSON.parse(JSON.stringify({ definition, requirement })), {
    definition: {
      id: "world.navigation", version: "1.2.0", scope: "public", description: "Finds an authorized world route.",
      inputSchema: { type: "object", required: ["from", "to"] }, outputSchema: { type: "object" },
    },
    requirement: { id: "world.navigation", version: "^1.0.0", optional: false },
  });
});
