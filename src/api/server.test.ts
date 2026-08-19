import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { AgentRunner } from "../core/agent-runner.js";
import type { AgentAction, GameState, Observation } from "../core/contracts.js";
import { GameRuntime } from "../core/runtime.js";
import { createGameApiServer } from "./server.js";
import type { PlayerInputInterpreter } from "../core/player-input.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import { StaticStoryChapterCatalog, StoryChapterPackageService } from "../story/chapter-packages.js";
import { createStoryChapterController } from "../plugins/feature/story-chapters.js";
import { fuyukiValidationPackage } from "../story/content/fuyuki-validation-package.js";
import { SqliteTurnCommitter } from "../persistence/turn-commit.js";

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

test("chapter API lists, enters, and resumes a registered chapter package", async () => {
  const repository = new SqliteCifRepository();
  const chapters = new StoryChapterPackageService(repository);
  const runtime = new GameRuntime(state(), { mash: new StubAgent() }, new SqliteTurnCommitter(repository), undefined, 0, chapters);
  const server = createGameApiServer(runtime, undefined, undefined, {
    chapters: createStoryChapterController(chapters, new StaticStoryChapterCatalog([fuyukiValidationPackage]), runtime),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const catalog = await fetch(`${base}/sessions/demo/chapters?playerId=player`).then(async (response) => ({ status: response.status, body: await response.json() as Array<{ packageId: string; active: boolean }> }));
    assert.equal(catalog.status, 200);
    assert.deepEqual(catalog.body, [{ packageId: "validation:fuyuki:v1", contentType: "main", contentId: "fuyuki", entryNodeId: "fuyuki:secure-gate", canonAnchor: "fgo:singularity-f:fuyuki:entry", version: 1, active: false }]);
    const entry = { id: "chapter:fuyuki:entry", playerId: "player", packageId: "validation:fuyuki:v1", mode: "new" };
    const entered = await fetch(`${base}/sessions/demo/chapters/enter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entry) });
    assert.equal(entered.status, 200);
    assert.equal(repository.countObjectiveHistory("demo"), 1);
    assert.equal(runtime.getEvents()[0]?.type, "chapter_entered");
    const replay = await fetch(`${base}/sessions/demo/chapters/enter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entry) });
    assert.equal(replay.status, 200);
    assert.equal(repository.countObjectiveHistory("demo"), 1);
    const current = await fetch(`${base}/sessions/demo/chapters/current?playerId=player`).then((response) => response.json() as Promise<{ context: { canonAnchor: string }; chapters: Array<{ progress: { activeNodeId: string } }> }>);
    assert.equal(current.context.canonAnchor, "fgo:singularity-f:fuyuki:entry");
    assert.equal(current.chapters[0]?.progress.activeNodeId, "fuyuki:secure-gate");
    const resumed = await fetch(`${base}/sessions/demo/chapters/enter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "chapter:fuyuki:resume", playerId: "player", packageId: "validation:fuyuki:v1", mode: "resume" }) });
    assert.equal(resumed.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    repository.close();
  }
});
