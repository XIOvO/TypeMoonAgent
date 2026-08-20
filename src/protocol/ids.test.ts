import assert from "node:assert/strict";
import test from "node:test";
import type { ActionId, EventSequence, SessionId, StateRevision } from "./ids.js";

const sessionId = "session-42" as SessionId;
const actionId = "action-42" as ActionId;
const revision = 7 as StateRevision;
const sequence = 11 as EventSequence;

const stringWireValue: string = sessionId;
const numberWireValue: number = revision;
void stringWireValue;
void numberWireValue;

// @ts-expect-error IDs from different domains are not interchangeable.
const invalidSessionId: SessionId = actionId;
// @ts-expect-error Revision and sequence represent different counters.
const invalidRevision: StateRevision = sequence;
void invalidSessionId;
void invalidRevision;

test("branded protocol scalars remain JSON primitives", () => {
  const encoded = JSON.stringify({ sessionId, actionId, revision, sequence });

  assert.deepEqual(JSON.parse(encoded), {
    sessionId: "session-42",
    actionId: "action-42",
    revision: 7,
    sequence: 11,
  });
});
