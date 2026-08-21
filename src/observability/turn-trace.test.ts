import assert from "node:assert/strict";
import test from "node:test";
import type { ContextReference } from "../protocol/observation.js";
import { InMemoryTurnTraceStore, toTurnTrace, type TurnTraceInput } from "./turn-trace.js";

test("TurnTrace records correlation, provider, and context provenance without copying private text", () => {
  const privateContext: ContextReference = { type: "memory", id: "memory-1", summary: "private memory text" };
  const trace = toTurnTrace({
    id: "trace-1", sessionId: "demo", correlationId: "action:demo:wait-1", recordedAt: "2026-08-20T00:00:00.000Z",
    playerActionId: "wait-1", observationId: "observation-1", agentActionId: "agent-action-1",
    commandIds: ["command-1"], eventIds: ["event-1"], provider: { id: "rule", model: "local" },
    contextRefs: [privateContext], durationMs: 12, outcome: "succeeded",
  });
  assert.deepEqual(trace, {
    id: "trace-1", sessionId: "demo", correlationId: "action:demo:wait-1", recordedAt: "2026-08-20T00:00:00.000Z",
    playerActionId: "wait-1", observationId: "observation-1", agentActionId: "agent-action-1",
    commandIds: ["command-1"], eventIds: ["event-1"], provider: { id: "rule", model: "local" },
    contextRefs: [{ type: "memory", id: "memory-1" }], durationMs: 12, outcome: "succeeded",
  });
  assert.equal(JSON.stringify(trace).includes("private memory text"), false);
});

test("TurnTrace redacts hidden CIF and chain-of-thought fields", () => {
  const hiddenCif = "HIDDEN_CIF_SENTINEL";
  const chainOfThought = "HIDDEN_COT_SENTINEL";
  const context = {
    type: "identity" as const,
    id: "identity-1",
    summary: hiddenCif,
    reasoning: chainOfThought,
  };
  const contaminatedInput: TurnTraceInput & { hiddenCif: string; chainOfThought: string } = {
    id: "trace-redaction", sessionId: "demo", correlationId: "action:demo:redaction", recordedAt: "2026-08-20T00:00:00.000Z",
    contextRefs: [context], hiddenCif, chainOfThought,
  };

  const serialized = JSON.stringify(toTurnTrace(contaminatedInput));

  assert.equal(serialized.includes(hiddenCif), false);
  assert.equal(serialized.includes(chainOfThought), false);
  assert.deepEqual(JSON.parse(serialized), {
    id: "trace-redaction", sessionId: "demo", correlationId: "action:demo:redaction", recordedAt: "2026-08-20T00:00:00.000Z",
    commandIds: [], eventIds: [], contextRefs: [{ type: "identity", id: "identity-1" }],
  });
});

test("TurnTrace store filters by session and correlation without exposing mutable records", () => {
  const store = new InMemoryTurnTraceStore();
  store.record({ id: "one", sessionId: "demo", correlationId: "action:demo:1", recordedAt: "2026-08-20T00:00:00.000Z" });
  store.record({ id: "two", sessionId: "demo", correlationId: "action:demo:2", recordedAt: "2026-08-20T00:00:01.000Z" });
  const traces = store.list("demo", "action:demo:1");
  assert.deepEqual(traces.map((trace) => trace.id), ["one"]);
  (traces[0]!.commandIds as string[]).push("tamper");
  assert.deepEqual(store.list("demo", "action:demo:1")[0]?.commandIds, []);
});
