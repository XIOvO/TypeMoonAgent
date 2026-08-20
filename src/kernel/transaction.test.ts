import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeTransaction } from "./transaction.js";

test("transaction publishes only after a successful commit", () => {
  const transaction = new RuntimeTransaction();
  const order: string[] = [];
  transaction.commit({ commit: () => order.push("commit"), publish: () => order.push("publish") });
  assert.deepEqual(order, ["commit", "publish"]);
});

test("transaction does not publish when commit fails", () => {
  const transaction = new RuntimeTransaction();
  let published = false;
  assert.throws(() => transaction.commit({ commit: () => { throw new Error("failed"); }, publish: () => { published = true; } }), /failed/);
  assert.equal(published, false);
});
