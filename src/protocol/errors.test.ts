import assert from "node:assert/strict";
import test from "node:test";
import type { ErrorCode, ValidationIssue, ValidationResult } from "./errors.js";

const rejected = {
  ok: false,
  issues: [{ code: "action.invalid", field: "content", details: { reason: "blank" } }],
} satisfies ValidationResult;

const stableCode: ErrorCode = rejected.issues[0]!.code;
void stableCode;

// @ts-expect-error Error codes must use the public namespace vocabulary.
const invalidCode: ErrorCode = "invalid";
// @ts-expect-error Validation callers receive a code, not an unstable message.
const messageIssue: ValidationIssue = { code: "action.invalid", message: "content is blank" };
void invalidCode;
void messageIssue;

function rejectedCodes(result: ValidationResult): ErrorCode[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

test("validation results expose stable code-based failures", () => {
  assert.deepEqual(rejectedCodes({ ok: true }), []);
  assert.deepEqual(rejectedCodes(rejected), ["action.invalid"]);
  assert.deepEqual(JSON.parse(JSON.stringify(rejected)), {
    ok: false,
    issues: [{ code: "action.invalid", field: "content", details: { reason: "blank" } }],
  });
});
