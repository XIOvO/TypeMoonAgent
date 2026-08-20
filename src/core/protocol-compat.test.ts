import assert from "node:assert/strict";
import test from "node:test";
import type { ActionResult, GameEvent, GameMoment, Observation, PlayerAction } from "./contracts.js";

test("legacy core imports retain their serializable v0.2 shapes", () => {
  const moment: GameMoment = { timelineId: "session:demo", tick: 7, calendar: { day: 3 } };
  const action: PlayerAction = { id: "action-1", sessionId: "session:demo", actorId: "player", type: "dialogue" };
  const event: GameEvent = {
    id: "event-1", sessionId: action.sessionId, createdAt: "2026-08-20T00:00:00.000Z", sequence: 1,
    type: "player_spoke", payload: {}, causation: { playerActionId: action.id }, stateRevision: 1, moment,
  };
  const result: ActionResult = { actionId: action.id, events: [event], stateRevision: 1 };
  const observation: Observation = {
    id: "observation-1", sessionId: action.sessionId, recipientId: "mash", triggerActionId: action.id,
    scene: { id: "hall", visibleEntityIds: ["player", "mash"] }, incomingAction: { actorId: "player", type: "dialogue" },
    selfState: { id: "mash", locationId: "hall", mood: "calm" }, constraints: ["visible facts only"],
  };

  assert.deepEqual(JSON.parse(JSON.stringify({ result, observation })), { result, observation });
});
