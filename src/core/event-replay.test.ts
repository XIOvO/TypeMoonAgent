import assert from "node:assert/strict";
import test from "node:test";
import type { GameEvent, GameState } from "./contracts.js";
import { replayGameState } from "./event-replay.js";

const initial: GameState = {
  sessionId: "demo", revision: 0, moment: { timelineId: "session:demo", tick: 0 },
  characters: { player: { id: "player", locationId: "hall", mood: "calm" } },
  locations: { hall: { id: "hall", exits: ["bridge"] }, bridge: { id: "bridge", exits: ["hall"] } },
  objects: { gate: { id: "gate", kind: "door", locationId: "bridge", visible: true, tags: ["exit"], state: { open: false } } },
};

const events: GameEvent[] = [
  event(1, "character_moved", { characterId: "player", from: "hall", to: "bridge" }, 0),
  event(2, "object_interacted", { characterId: "player", objectId: "gate", method: "open", state: { open: true } }, 0),
  event(3, "time_waited", { characterId: "player", ticks: 1, fromTick: 0, toTick: 1 }, 1),
];

test("event replay deterministically rebuilds movement, object state, and game time", () => {
  const replayed = replayGameState(initial, events);
  assert.deepEqual(replayed, {
    ...initial, revision: 3, moment: { timelineId: "session:demo", tick: 1 },
    characters: { player: { id: "player", locationId: "bridge", mood: "calm" } },
    objects: { gate: { id: "gate", kind: "door", locationId: "bridge", visible: true, tags: ["exit"], state: { open: true } } },
  });
  assert.equal(initial.characters.player.locationId, "hall");
  assert.equal(initial.objects?.gate.state?.open, false);
});

test("event replay rejects a stream with a revision or sequence gap", () => {
  assert.throws(() => replayGameState(initial, [event(2, "time_waited", { ticks: 1 }, 1)]), /replay_revision_gap/);
  assert.throws(() => replayGameState(initial, [event(1, "time_waited", { ticks: 1 }, 1), event(3, "time_waited", { ticks: 1 }, 2)]), /replay_sequence_gap/);
});

function event(sequence: number, type: GameEvent["type"], payload: Record<string, unknown>, tick: number): GameEvent {
  return { id: `event-${sequence}`, sessionId: "demo", createdAt: "2026-08-20T00:00:00.000Z", sequence, type, payload, causation: { playerActionId: `action-${sequence}` }, stateRevision: sequence, moment: { timelineId: "session:demo", tick } };
}
