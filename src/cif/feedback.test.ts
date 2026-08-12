import assert from "node:assert/strict";
import test from "node:test";
import type { GameEvent } from "../core/contracts.js";
import { SqliteCifFeedbackSink } from "./feedback.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

test("feedback appends objective history but only grants evidence to witnesses", () => {
  const repository = new SqliteCifRepository();
  const sink = new SqliteCifFeedbackSink(repository);
  const event: GameEvent = { id: "event-1", sessionId: "demo", createdAt: "2026-08-11T10:00:00Z", sequence: 1, type: "character_spoke", payload: { characterId: "mash", text: "I am here." }, causation: { playerActionId: "action-1" }, stateRevision: 1 };
  sink.record(event, ["mash", "player"]);
  assert.equal(repository.listEvidence("demo", "mash", 5).length, 1);
  assert.equal(repository.listEvidence("demo", "player", 5).length, 1);
  assert.equal(repository.listEvidence("demo", "unseen_character", 5).length, 0);
  assert.equal(repository.getRuntimeState("demo", "player")?.attention[0], "mash");
  repository.close();
});
