import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as sdk from "./index.js";

test("SDK runtime entry exports definitions, test runtime, conformance, and public combat contracts", () => {
  assert.deepEqual(Object.keys(sdk).sort(), [
    "COMBAT_RESOLVE_CAPABILITY",
    "COMBAT_RESOLVE_CAPABILITY_DEFINITION",
    "COMBAT_RESOLVE_COMMAND_SCHEMA",
    "createTestRuntime",
    "defineAgentProvider",
    "defineCapability",
    "defineEventSchema",
    "defineJobHandler",
    "definePlugin",
    "isCombatResolveCommand",
    "runAgentProviderConformance",
    "runPluginConformance",
  ]);
});

test("SDK declaration graph does not reference private implementations", async () => {
  const declarations = await Promise.all([
    "./index.d.ts",
    "./definitions.d.ts",
    "./types.d.ts",
    "./test-runtime.d.ts",
    "./conformance.d.ts",
    "../agent/provider.d.ts",
    "../protocol/combat-commands.d.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const publicSurface = declarations.join("\n");

  assert.doesNotMatch(publicSurface, /\.\.\/core\//);
  assert.doesNotMatch(publicSurface, /\.\.\/persistence\//);
  assert.doesNotMatch(publicSurface, /\.\.\/plugins\//);
  assert.doesNotMatch(publicSurface, /\.\.\/agents\//);
  assert.doesNotMatch(publicSurface, /\.\.\/api\//);
  assert.doesNotMatch(publicSurface, /@deepseek-ai\/cordis|@earendil-works\/pi-|sqlite/i);
});
