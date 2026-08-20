import assert from "node:assert/strict";
import test from "node:test";
import { IdempotencyRegistry } from "./idempotency.js";

test("idempotency registry replays processed results and rejects changed fingerprints", async () => {
  const registry = new IdempotencyRegistry<number>();
  registry.remember("a", "one", 1);
  assert.equal(await registry.run({ id: "a", fingerprint: "one", load: () => undefined, enqueue: (run) => run(), operation: async () => 2 }), 1);
  assert.throws(() => registry.run({ id: "a", fingerprint: "two", load: () => undefined, enqueue: (run) => run(), operation: async () => 2 }), /action_id_conflict/);
});

test("idempotency registry shares in-flight work and clears it after completion", async () => {
  const registry = new IdempotencyRegistry<number>();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const input = { id: "a", fingerprint: "one", load: () => undefined, enqueue: (run: () => Promise<number>) => run(), operation: async () => { await gate; return 1; } };
  const first = registry.run(input);
  const second = registry.run(input);
  assert.equal(first, second);
  assert.equal(registry.activeFingerprint("a"), "one");
  release();
  assert.equal(await first, 1);
  assert.equal(registry.activeFingerprint("a"), undefined);
});
