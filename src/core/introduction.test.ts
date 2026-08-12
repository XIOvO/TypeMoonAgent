import assert from "node:assert/strict";
import test from "node:test";
import { GameRuntime } from "./runtime.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import { SqliteTurnCommitter } from "../persistence/turn-commit.js";
import type { GameState } from "./contracts.js";

const state = (): GameState => ({
  sessionId: "demo", revision: 0,
  characters: { player: { id: "player", locationId: "station", mood: "calm" as const } },
  locations: { station: { id: "station", exits: [] } },
});

test("Runtime introduces only a character with a published initialization and emits a visible event", () => {
  const repository = new SqliteCifRepository();
  const runtime = new GameRuntime(state(), {}, new SqliteTurnCommitter(repository), {
    hasPublishedInitialization: (_sessionId, characterId) => characterId === "mash",
  });
  const result = runtime.introduceCharacter({ id: "intro-1", sessionId: "demo", characterId: "mash", locationId: "station", reason: "story_trigger", mood: "alert" });
  assert.equal(runtime.getState().characters.mash?.locationId, "station");
  assert.equal(result.events[0]?.type, "character_introduced");
  assert.equal(result.events[0]?.causation.systemActionId, "intro-1");
  assert.equal(repository.countObjectiveHistory("demo"), 1);
  assert.equal(repository.listEvidence("demo", "player", 3)[0]?.content, "mash appeared at station.");
  assert.throws(() => runtime.introduceCharacter({ id: "intro-2", sessionId: "demo", characterId: "other", locationId: "station", reason: "story_trigger" }), /character_initialization_not_published/);
  repository.close();
});

test("Runtime resumes event sequences after prior persisted system events", () => {
  const runtime = new GameRuntime(state(), {}, undefined, { hasPublishedInitialization: () => true }, 7);
  const result = runtime.introduceCharacter({ id: "intro-1", sessionId: "demo", characterId: "mash", locationId: "station", reason: "summon" });
  assert.equal(result.events[0]?.sequence, 8);
});

test("Runtime starts a battle only from a trusted request with present allies", () => {
  const initial = state();
  initial.characters = { ...initial.characters, mash: { id: "mash", locationId: "station", mood: "alert" } };
  const runtime = new GameRuntime(initial, {});
  const result = runtime.startBattle({
    id: "battle:intro", sessionId: "demo", locationId: "station", objective: "Defend the station.",
    allies: [
      { id: "player", hp: 4, maxHp: 4, states: [] },
      { id: "mash", hp: 5, maxHp: 5, states: [] },
    ],
    enemies: [{ id: "skeleton", hp: 3, maxHp: 3, states: [] }],
  });
  assert.equal(result.events[0]?.type, "battle_started");
  assert.equal(runtime.getState().battle?.status, "active");
  assert.equal(runtime.getState().battle?.allies.mash?.hp, 5);
  assert.throws(() => runtime.startBattle({
    id: "battle:again", sessionId: "demo", locationId: "station", objective: "Another battle.",
    allies: [{ id: "player", hp: 4, maxHp: 4, states: [] }],
    enemies: [{ id: "other", hp: 1, maxHp: 1, states: [] }],
  }), /battle_already_active/);

  const absentRuntime = new GameRuntime(state(), {});
  assert.throws(() => absentRuntime.startBattle({
    id: "battle:absent", sessionId: "demo", locationId: "station", objective: "Invalid.",
    allies: [{ id: "mash", hp: 5, maxHp: 5, states: [] }],
    enemies: [{ id: "other", hp: 1, maxHp: 1, states: [] }],
  }), /battle_ally_not_at_location/);
});
