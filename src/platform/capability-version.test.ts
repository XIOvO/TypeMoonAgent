import assert from "node:assert/strict";
import test from "node:test";
import { isCapabilityVersionCompatible } from "./capability-version.js";

test("capability versions support exact and caret compatibility", () => {
  assert.equal(isCapabilityVersionCompatible("1.2.3", "1.2.3"), true);
  assert.equal(isCapabilityVersionCompatible("1.2.4", "1.2.3"), false);
  assert.equal(isCapabilityVersionCompatible("1.4.0", "^1.2.3"), true);
  assert.equal(isCapabilityVersionCompatible("2.0.0", "^1.2.3"), false);
  assert.equal(isCapabilityVersionCompatible("0.2.5", "^0.2.3"), true);
  assert.equal(isCapabilityVersionCompatible("0.3.0", "^0.2.3"), false);
});

test("capability version mismatches and malformed values are rejected", () => {
  assert.equal(isCapabilityVersionCompatible("1.2.3", "^1.3.0"), false);
  assert.equal(isCapabilityVersionCompatible("1.2", "^1.0.0"), false);
  assert.equal(isCapabilityVersionCompatible("1.2.3", "latest"), false);
});
