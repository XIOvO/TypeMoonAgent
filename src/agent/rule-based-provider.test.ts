import assert from "node:assert/strict";
import test from "node:test";
import { RuleBasedAgentProvider } from "./rule-based-provider.js";
import { GameRuntime } from "../core/runtime.js";
import type { GameState, Observation } from "../core/contracts.js";

const observation = { id: "observation:1", sessionId: "demo", recipientId: "mash" } as Observation;

test("RuleBasedAgentProvider is deterministic and needs no model credentials", async () => {
  const provider = new RuleBasedAgentProvider();
  assert.equal(provider.supports({ characterId: "mash", agentProfile: "rule" }), true);
  assert.equal(provider.supports({ characterId: "mash", agentProfile: "pi" }), false);
  assert.deepEqual(await provider.run(observation), await provider.run(observation));

  const world: GameState = {
    sessionId: "demo", revision: 0,
    characters: { player: { id: "player", locationId: "hall", mood: "calm" }, mash: { id: "mash", locationId: "hall", mood: "calm" } },
    locations: { hall: { id: "hall", exits: [] } },
  };
  const result = await new GameRuntime(world, { mash: provider }).handlePlayerAction({
    id: "player:1", sessionId: "demo", actorId: "player", type: "dialogue", content: "在吗？", targetIds: ["mash"],
  });
  assert.deepEqual(result.events.map((event) => event.type), ["player_spoke", "character_spoke"]);
});
