import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { AgentRunner } from "../core/agent-runner.js";
import type { AgentAction, GameState, Observation } from "../core/contracts.js";
import { GameRuntime } from "../core/runtime.js";
import { createGameApiServer } from "./server.js";
import type { PlayerInputInterpreter } from "../core/player-input.js";

class StubAgent implements AgentRunner {
  public async run(observation: Observation): Promise<AgentAction> {
    return { id: "aa", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id, utterance: "Hello.", requests: [] };
  }
}

const state = (): GameState => ({
  sessionId: "demo", revision: 0,
  characters: { player: { id: "player", locationId: "hall", mood: "calm" }, mash: { id: "mash", locationId: "hall", mood: "calm" }, hidden: { id: "hidden", locationId: "vault", mood: "alert" } },
  locations: { hall: { id: "hall", exits: [] }, vault: { id: "vault", exits: [] } },
});

test("Game API returns a player-visible state projection and accepts PlayerAction", async () => {
  const server = createGameApiServer(new GameRuntime(state(), { mash: new StubAgent() }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const page = await fetch(base).then((response) => response.text());
    assert.match(page, /叙事播放原型/);
    assert.match(page, /action-form/);
    const snapshot = await fetch(`${base}/sessions/demo/state?playerId=player`).then(async (response) => ({ status: response.status, body: await response.json() as { characters: Array<{ id: string }> }}));
    assert.equal(snapshot.status, 200);
    assert.deepEqual(snapshot.body.characters.map((character) => character.id).sort(), ["mash", "player"]);
    const action = await fetch(`${base}/sessions/demo/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "pa", sessionId: "demo", actorId: "player", type: "dialogue", content: "Hi", targetIds: ["mash"] }) });
    assert.equal(action.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Game API sends auto player input through the configured interpreter", async () => {
  const interpreter: PlayerInputInterpreter = { interpret: async (input) => ({
    kind: "resolved", action: {
      id: input.id, sessionId: input.sessionId, actorId: input.actorId, type: "dialogue",
      content: "I am fine.", targetIds: ["mash"],
    }, privateThought: "Actually afraid.",
  }) };
  const server = createGameApiServer(new GameRuntime(state(), { mash: new StubAgent() }), undefined, interpreter);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const response = await fetch(`${base}/sessions/demo/actions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "mixed-1", sessionId: "demo", actorId: "player", mode: "auto", content: "I say I am fine while hiding fear." }),
    });
    const result = await response.json() as { events: Array<{ type: string; payload: { text?: string } }> };
    assert.equal(response.status, 200);
    assert.equal(result.events[0]?.type, "player_spoke");
    assert.equal(result.events[0]?.payload.text, "I am fine.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
