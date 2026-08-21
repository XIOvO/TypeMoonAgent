import assert from "node:assert/strict";
import test from "node:test";
import type { BattleCombatant, GameState } from "../core/contracts.js";
import { buildPlayerVisibleState } from "./projection.js";

test("player-visible projection redacts hidden CIF and chain-of-thought fields", () => {
  const hiddenCif = "HIDDEN_CIF_SENTINEL";
  const chainOfThought = "HIDDEN_COT_SENTINEL";
  const contaminatedEnemy: BattleCombatant & { hiddenCif: string; chainOfThought: string } = {
    id: "enemy", hp: 8, maxHp: 10, states: ["guarding"], hiddenCif, chainOfThought,
  };
  const state: GameState & { hiddenCif: string; chainOfThought: string } = {
    sessionId: "demo", revision: 4, hiddenCif, chainOfThought,
    locations: { hall: { id: "hall", exits: ["vault"] }, vault: { id: "vault", exits: [] } },
    characters: {
      player: { id: "player", locationId: "hall", mood: "calm" },
      mash: { id: "mash", locationId: "hall", mood: "alert", hiddenCif, chainOfThought },
    } as GameState["characters"],
    objects: {
      door: { id: "door", kind: "door", locationId: "hall", visible: true, tags: ["exit"], state: { open: false }, hiddenCif, chainOfThought },
    } as GameState["objects"],
    battle: {
      id: "battle", locationId: "hall", status: "active", turn: 2, objective: "Survive",
      allies: { mash: { id: "mash", hp: 10, maxHp: 10, states: [] } },
      enemies: { enemy: contaminatedEnemy }, hiddenCif, chainOfThought,
    } as GameState["battle"],
  };

  const serialized = JSON.stringify(buildPlayerVisibleState(state, "player"));

  assert.equal(serialized.includes(hiddenCif), false);
  assert.equal(serialized.includes(chainOfThought), false);
});
