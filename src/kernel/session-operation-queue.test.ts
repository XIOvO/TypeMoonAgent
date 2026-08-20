import assert from "node:assert/strict";
import test from "node:test";
import { SessionOperationQueue } from "./session-operation-queue.js";

test("same-session operations run in order and recover after a rejection", async () => {
  const queue = new SessionOperationQueue();
  const order: string[] = [];
  const first = queue.enqueue("session-1", async () => { order.push("first"); throw new Error("expected"); });
  const second = queue.enqueue("session-1", async () => { order.push("second"); return 2; });

  await assert.rejects(first, /expected/);
  assert.equal(await second, 2);
  assert.deepEqual(order, ["first", "second"]);
});

test("different sessions may begin before either one completes", async () => {
  const queue = new SessionOperationQueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let secondStarted = false;
  const first = queue.enqueue("session-1", async () => gate);
  const second = queue.enqueue("session-2", async () => { secondStarted = true; });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(secondStarted, true);
  release();
  await Promise.all([first, second]);
});
