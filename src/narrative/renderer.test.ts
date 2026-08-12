import assert from "node:assert/strict";
import test from "node:test";
import type { GameEvent } from "../core/contracts.js";
import { DeterministicNarrativeRenderer } from "./renderer.js";

const event = (type: GameEvent["type"], payload: Record<string, unknown>): GameEvent => ({
  id: "event-1", sessionId: "demo", createdAt: "2026-08-12T00:00:00.000Z", sequence: 1, type, payload, causation: {}, stateRevision: 4,
});

test("renderer turns confirmed dialogue into a replayable backlog block", () => {
  const beat = new DeterministicNarrativeRenderer().render(event("character_spoke", { characterId: "mash", text: "前辈，请留在我身后。" }));
  assert.deepEqual(beat, {
    id: "beat:event-1", sourceEventIds: ["event-1"], stateRevision: 4,
    blocks: [{ id: "event-1", kind: "dialogue", record: "backlog", speakerId: "mash", speakerName: "mash", text: "前辈，请留在我身后。" }],
  });
});

test("renderer reserves scene transitions for confirmed movement", () => {
  const beat = new DeterministicNarrativeRenderer().render(event("character_moved", { characterId: "player", from: "hall", to: "cafeteria" }));
  assert.equal(beat.blocks[0]?.kind, "scene_transition");
  assert.equal(beat.blocks[0]?.record, "world");
});

test("renderer keeps rejected actions and battle round counters out of permanent records", () => {
  const renderer = new DeterministicNarrativeRenderer();
  assert.equal(renderer.render(event("action_rejected", { reason: "destination_unreachable" })).blocks[0]?.record, "none");
  assert.equal(renderer.render(event("battle_round_resolved", { turn: 2 })).blocks[0]?.record, "none");
});
