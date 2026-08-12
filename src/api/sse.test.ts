import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { AgentRunner } from "../core/agent-runner.js";
import type { AgentAction, GameState, Observation } from "../core/contracts.js";
import { GameRuntime } from "../core/runtime.js";
import { createGameApiServer } from "./server.js";

class StubAgent implements AgentRunner {
  public async run(observation: Observation): Promise<AgentAction> {
    return { id: "aa", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id, utterance: "Hello.", requests: [] };
  }
}

const state = (): GameState => ({ sessionId: "demo", revision: 0, characters: { player: { id: "player", locationId: "hall", mood: "calm" }, mash: { id: "mash", locationId: "hall", mood: "calm" }, hidden: { id: "hidden", locationId: "vault", mood: "alert" } }, locations: { hall: { id: "hall", exits: [] }, vault: { id: "vault", exits: [] } } });

test("SSE sends committed events and their zero-model NarrativeBeats only to visible recipients", async () => {
  const runtime = new GameRuntime(state(), { mash: new StubAgent() });
  const server = createGameApiServer(runtime);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const abort = new AbortController();
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const stream = await fetch(`${base}/sessions/demo/events?playerId=player`, { signal: abort.signal });
    const reader = stream.body?.getReader();
    assert.ok(reader);
    await reader.read(); // ready event
    await fetch(`${base}/sessions/demo/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "pa", sessionId: "demo", actorId: "player", type: "dialogue", content: "Hi", targetIds: ["mash"] }) });
    const message = new TextDecoder().decode((await reader.read()).value);
    assert.match(message, /event: game_event/);
    assert.match(message, /character_spoke/);
    assert.match(message, /event: narrative_beat/);
    assert.match(message, /beat:/);
  } finally {
    abort.abort();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
