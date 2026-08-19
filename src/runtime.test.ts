import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunner } from "./core/agent-runner.js";
import type { AgentAction, BattleState, CombinedTurnProposal, GameState, Observation, RawPlayerInput } from "./core/contracts.js";
import { GameRuntime } from "./core/runtime.js";
import { SqliteCifRepository } from "./cif/sqlite-repository.js";
import { SqliteTurnCommitter } from "./persistence/turn-commit.js";

const state = (): GameState => ({
  sessionId: "demo", revision: 0,
  characters: {
    player: { id: "player", locationId: "hall", mood: "calm" },
    mash: { id: "mash", locationId: "hall", mood: "calm" },
  },
  locations: { hall: { id: "hall", exits: ["cafeteria"] }, cafeteria: { id: "cafeteria", exits: ["hall"] } },
  objects: {
    hall_door: { id: "hall_door", kind: "door", locationId: "hall", visible: true, tags: ["door"], inspectText: "An unlocked door.", state: { open: false, locked: false } },
    hidden_note: { id: "hidden_note", kind: "document", locationId: "hall", visible: false, tags: ["secret"] },
  },
});

const battle = (): BattleState => ({
  id: "battle-1", locationId: "hall", status: "active", turn: 1, objective: "Protect the Chaldea corridor.",
  allies: {
    player: { id: "player", hp: 4, maxHp: 4, states: [] },
    mash: { id: "mash", hp: 5, maxHp: 5, states: [] },
  },
  enemies: { skeleton: { id: "skeleton", hp: 3, maxHp: 3, states: [] } },
});

class MashStub implements AgentRunner {
  public async run(observation: Observation): Promise<AgentAction> {
    return {
      id: "aa-1", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id,
      utterance: "好的，前辈。我陪您一起去。",
      requests: [{ type: "move", actorId: "mash", destination: "cafeteria" }],
    };
  }
}

class CombinedMashStub extends MashStub {
  public async runCombined(observation: Observation, _input: RawPlayerInput): Promise<CombinedTurnProposal> {
    return {
      player: { type: "dialogue", publicText: "I am fine.", targetIds: ["mash"], privateThought: "Actually afraid." },
      character: { id: "combined-aa", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id, utterance: "I understand.", requests: [] },
    };
  }
}

test("Runtime uses the injected interaction resolver before waking a dialogue Agent", async () => {
  const runtime = new GameRuntime(state(), { mash: new MashStub() }, undefined, undefined, 0, undefined, undefined, undefined, {
    resolve: ({ requestedTargetId }) => requestedTargetId ?? "mash",
  });
  const result = await runtime.handlePlayerAction({ id: "coordinated-dialogue", sessionId: "demo", actorId: "player", type: "dialogue", content: "Can you help?" });
  assert.deepEqual(result.events.map((event) => event.type), ["player_spoke", "character_spoke", "character_moved"]);
  assert.equal(result.events[0]?.payload.targetId, "mash");
});

class DeferredMashStub implements AgentRunner {
  public readonly started: Promise<void>;
  private readonly start: () => void;
  private readonly settled: Promise<void>;
  private readonly fail: () => void;

  public constructor() {
    [this.started, this.start] = deferred();
    let reject: ((error: Error) => void) | undefined;
    this.settled = new Promise<void>((_done, failed) => { reject = failed; });
    this.fail = () => reject?.(new Error("deferred_agent_failed"));
  }

  public async run(observation: Observation): Promise<AgentAction> {
    this.start();
    await this.settled;
    return { id: "deferred-aa", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id, utterance: "收到。", requests: [] };
  }

  public reject(): void { this.fail(); }
}

function deferred(): [Promise<void>, () => void] {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => { resolve = done; });
  return [promise, () => resolve?.()];
}

test("Runtime records dialogue and validates an Agent-requested move", async () => {
  const runtime = new GameRuntime(state(), { mash: new MashStub() });
  const result = await runtime.handlePlayerAction({ id: "pa-1", sessionId: "demo", actorId: "player", type: "dialogue", content: "去食堂吧", targetIds: ["mash"] });
  assert.deepEqual(result.events.map((event) => event.type), ["player_spoke", "character_spoke", "character_moved"]);
  assert.equal(runtime.getState().characters.mash.locationId, "cafeteria");
  const replay = await runtime.handlePlayerAction({ id: "pa-1", sessionId: "demo", actorId: "player", type: "dialogue", content: "去食堂吧", targetIds: ["mash"] });
  assert.equal(replay.events.length, 3);
  assert.equal(runtime.getEvents().length, 3);
});

test("Runtime serializes different actions so a later commit survives an earlier async failure", async () => {
  const agent = new DeferredMashStub();
  const runtime = new GameRuntime(state(), { mash: agent });
  const first = runtime.handlePlayerAction({ id: "first", sessionId: "demo", actorId: "player", type: "dialogue", content: "等等。", targetIds: ["mash"] });
  await agent.started;
  const second = runtime.handlePlayerAction({ id: "second", sessionId: "demo", actorId: "player", type: "action", parameters: { intent: "move", destination: "cafeteria" } });
  let secondSettled = false;
  void second.then(() => { secondSettled = true; });
  await Promise.resolve();
  assert.equal(secondSettled, false);
  agent.reject();
  await assert.rejects(first, /deferred_agent_failed/);
  const result = await second;
  assert.equal(result.events[0]?.type, "character_moved");
  assert.equal(runtime.getState().characters.player.locationId, "cafeteria");
  assert.deepEqual(runtime.getEvents().map((event) => event.causation.playerActionId), ["second"]);
});

test("Runtime publishes one durable turn batch after AgentAction is settled", async () => {
  const repository = new SqliteCifRepository();
  const runtime = new GameRuntime(state(), { mash: new MashStub() }, new SqliteTurnCommitter(repository));
  await runtime.handlePlayerAction({ id: "pa-commit", sessionId: "demo", actorId: "player", type: "dialogue", content: "去食堂吧", targetIds: ["mash"] });
  assert.equal(repository.countObjectiveHistory("demo"), 3);
  assert.equal(repository.listEvidence("demo", "player", 5).length, 3);
  repository.close();
});

test("a restarted Runtime replays a processed action without calling the Agent or writing again", async () => {
  const repository = new SqliteCifRepository();
  const first = new GameRuntime(state(), { mash: new MashStub() }, new SqliteTurnCommitter(repository));
  const action = { id: "pa-restart", sessionId: "demo", actorId: "player", type: "dialogue" as const, content: "去食堂吧", targetIds: ["mash"] };
  const settled = await first.handlePlayerAction(action);
  const resumed = new GameRuntime(repository.loadWorldState("demo")!, { mash: { run: async () => { throw new Error("agent_should_not_run"); } } },
    new SqliteTurnCommitter(repository), undefined, repository.nextObjectiveSequence("demo") - 1);
  const replay = await resumed.handlePlayerAction(action);
  assert.deepEqual(replay, settled);
  assert.equal(repository.countObjectiveHistory("demo"), settled.events.length);
  repository.close();
});

test("Runtime rejects a reused action ID when its request changes", async () => {
  const repository = new SqliteCifRepository();
  let calls = 0;
  const agent: AgentRunner = { run: async (observation) => {
    calls += 1;
    return { id: "aa-fingerprint", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id, utterance: "收到。", requests: [] };
  } };
  const runtime = new GameRuntime(state(), { mash: agent }, new SqliteTurnCommitter(repository));
  await runtime.handlePlayerAction({ id: "pa-fingerprint", sessionId: "demo", actorId: "player", type: "dialogue", content: "第一句话", targetIds: ["mash"] });
  await assert.rejects(
    runtime.handlePlayerAction({ id: "pa-fingerprint", sessionId: "demo", actorId: "player", type: "dialogue", content: "另一句话", targetIds: ["mash"] }),
    /action_id_conflict/,
  );
  assert.equal(calls, 1);
  assert.equal(repository.countObjectiveHistory("demo"), 2);
  repository.close();
});

test("combined turn path settles public player speech and character reply from one proposal", async () => {
  const repository = new SqliteCifRepository();
  const runtime = new GameRuntime(state(), { mash: new CombinedMashStub() }, new SqliteTurnCommitter(repository));
  const result = await runtime.handleRawPlayerInput({
    id: "raw-1", sessionId: "demo", actorId: "player", mode: "auto", targetIds: ["mash"],
    content: "I say I am fine while hiding my fear.",
  });
  assert.deepEqual(result.events.map((event) => event.type), ["player_spoke", "character_spoke"]);
  assert.equal(result.events[0]?.payload.text, "I am fine.");
  assert.equal(result.events[1]?.payload.text, "I understand.");
  assert.doesNotMatch(JSON.stringify(result.events), /Actually afraid\./);
  assert.deepEqual(repository.listPlayerPrivateNotes("demo", "player", 5).map((note) => ({ sourceInputId: note.sourceInputId, content: note.content })), [{ sourceInputId: "raw-1", content: "Actually afraid." }]);
  repository.close();
});

test("Runtime keeps dialogue, open world actions, and combat as distinct input lanes", async () => {
  const runtime = new GameRuntime(state(), { mash: new MashStub() });
  const observe = await runtime.handlePlayerAction({
    id: "pa-observe", sessionId: "demo", actorId: "player", type: "action", parameters: { intent: "observe" },
  });
  assert.deepEqual(observe.events.map((event) => event.type), ["area_observed"]);

  const move = await runtime.handlePlayerAction({
    id: "pa-move", sessionId: "demo", actorId: "player", type: "action", parameters: { intent: "move", destination: "cafeteria" },
  });
  assert.deepEqual(move.events.map((event) => event.type), ["character_moved"]);
  assert.equal(runtime.getState().characters.player.locationId, "cafeteria");

  const combat = await runtime.handlePlayerAction({
    id: "pa-combat", sessionId: "demo", actorId: "player", type: "combat", parameters: { action: "attack", targetId: "mash" },
  });
  assert.equal(combat.events[0]?.payload.reason, "battle_not_active");

  const freeform = await runtime.handlePlayerAction({
    id: "pa-freeform", sessionId: "demo", actorId: "player", type: "action",
    content: "I examine the unusual mark on the wall from the side.",
    parameters: { intent: "inspect_hidden_mark", approach: "side" },
  });
  assert.equal(freeform.events[0]?.payload.reason, "action_requires_resolver");
});

test("Runtime advances authoritative game time only for a settled wait", async () => {
  const repository = new SqliteCifRepository();
  const runtime = new GameRuntime(state(), { mash: new MashStub() }, new SqliteTurnCommitter(repository));
  const dialogue = await runtime.handlePlayerAction({ id: "time-dialogue", sessionId: "demo", actorId: "player", type: "dialogue", content: "在吗？", targetIds: ["mash"] });
  assert.equal(dialogue.events[0]?.moment?.tick, 0);
  const waited = await runtime.handlePlayerAction({ id: "time-wait", sessionId: "demo", actorId: "player", type: "action", parameters: { intent: "wait" } });
  assert.deepEqual(waited.events[0]?.moment, { timelineId: "session:demo", tick: 1 });
  assert.equal(runtime.getState().moment?.tick, 1);
  const resumed = new GameRuntime(repository.loadWorldState("demo")!, { mash: new MashStub() }, new SqliteTurnCommitter(repository), undefined, repository.nextObjectiveSequence("demo") - 1);
  const replay = await resumed.handlePlayerAction({ id: "time-wait", sessionId: "demo", actorId: "player", type: "action", parameters: { intent: "wait" } });
  assert.deepEqual(replay, waited);
  repository.close();
});

test("Runtime settles a same-scene proactive opener as a system-caused character speech only", async () => {
  const repository = new SqliteCifRepository();
  const runtime = new GameRuntime(state(), { mash: { run: async (observation) => ({
    id: "initiative-aa", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id,
    utterance: "前辈，需要我陪您待一会儿吗？", requests: [],
  }) } }, new SqliteTurnCommitter(repository));
  const result = await runtime.runCharacterInitiative({ id: "initiative-1", sessionId: "demo", playerId: "player", characterId: "mash", reason: "active_goal" });
  assert.deepEqual(result.events.map((event) => event.type), ["character_spoke"]);
  assert.deepEqual(result.events[0]?.causation, { systemActionId: "initiative-1", agentActionId: "initiative-aa" });
  assert.equal(result.events[0]?.payload.targetId, "player");
  assert.equal(repository.countObjectiveHistory("demo"), 1);
  repository.close();
});

test("Runtime rejects proactive proposals that request a world change", async () => {
  const runtime = new GameRuntime(state(), { mash: { run: async (observation) => ({
    id: "initiative-move", sessionId: observation.sessionId, actorId: "mash", observationId: observation.id,
    utterance: "我去前面看看。", requests: [{ type: "move", actorId: "mash", destination: "cafeteria" }],
  }) } });
  await assert.rejects(runtime.runCharacterInitiative({ id: "initiative-move", sessionId: "demo", playerId: "player", characterId: "mash", reason: "active_goal" }), /invalid_proactive_agent_action/);
  assert.equal(runtime.getState().characters.mash.locationId, "hall");
  assert.equal(runtime.getEvents().length, 0);
});

test("Runtime moves an approaching character one deterministic map edge only", async () => {
  const approaching = state();
  approaching.characters.player.locationId = "cafeteria";
  approaching.locations.hall.exits = ["mid", "cafeteria"];
  approaching.locations.mid = { id: "mid", exits: ["hall", "cafeteria"] };
  const runtime = new GameRuntime(approaching, {});
  const result = await runtime.moveCharacterTowardPlayer({ id: "approach-1", sessionId: "demo", playerId: "player", characterId: "mash", expectedPlayerLocationId: "cafeteria", reason: "approach_player" });
  assert.deepEqual(result.events.map((event) => event.type), ["character_moved"]);
  assert.equal(result.events[0]?.payload.to, "cafeteria");
  assert.equal(runtime.getState().characters.mash.locationId, "cafeteria");
});

test("Runtime rejects an invalid persisted game moment before accepting input", () => {
  const invalid = state();
  invalid.moment = { timelineId: "main", tick: -1 };
  assert.throws(() => new GameRuntime(invalid, { mash: new MashStub() }), /invalid_game_moment/);
});

test("Runtime settles a concrete battle command and exposes a compact battle state", async () => {
  const initial = state();
  initial.battle = battle();
  const runtime = new GameRuntime(initial, { mash: new MashStub() });
  const result = await runtime.handlePlayerAction({
    id: "battle-command", sessionId: "demo", actorId: "player", type: "combat",
    parameters: { participation: "command", commands: [{ actorId: "mash", intent: "attack", targetId: "skeleton" }] },
  });
  assert.deepEqual(result.events.map((event) => event.type), ["battle_round_resolved"]);
  assert.equal(runtime.getState().battle?.enemies.skeleton?.hp, 2);
  assert.equal(runtime.getState().battle?.turn, 2);
});

test("Runtime lets the player delegate a round or explicitly quick-resolve a battle", async () => {
  const delegatedState = state();
  delegatedState.battle = battle();
  const delegatedRuntime = new GameRuntime(delegatedState, { mash: new MashStub() });
  const delegated = await delegatedRuntime.handlePlayerAction({
    id: "battle-delegate", sessionId: "demo", actorId: "player", type: "combat",
    parameters: { participation: "delegate", delegateTo: ["mash"] },
  });
  assert.equal(delegated.events[0]?.payload.participation, "delegate");
  assert.equal(delegatedRuntime.getState().battle?.enemies.skeleton?.hp, 2);

  const quickState = state();
  quickState.battle = battle();
  const quickRuntime = new GameRuntime(quickState, { mash: new MashStub() });
  const quick = await quickRuntime.handlePlayerAction({
    id: "battle-quick", sessionId: "demo", actorId: "player", type: "combat",
    parameters: { participation: "quick_resolve" },
  });
  assert.deepEqual(quick.events.map((event) => event.type), ["battle_round_resolved", "battle_finished"]);
  assert.equal(quickRuntime.getState().battle?.outcome, "victory");
});

test("Runtime inspects visible scene objects and changes a door state deterministically", async () => {
  const runtime = new GameRuntime(state(), { mash: new MashStub() });
  const inspected = await runtime.handlePlayerAction({
    id: "inspect-door", sessionId: "demo", actorId: "player", type: "action", parameters: { intent: "inspect", targetId: "hall_door" },
  });
  assert.equal(inspected.events[0]?.type, "object_inspected");
  assert.equal(inspected.events[0]?.payload.description, "An unlocked door.");
  const opened = await runtime.handlePlayerAction({
    id: "open-door", sessionId: "demo", actorId: "player", type: "action", parameters: { intent: "interact", targetId: "hall_door", method: "open" },
  });
  assert.equal(opened.events[0]?.type, "object_interacted");
  assert.equal(opened.events[0]?.payload.state && (opened.events[0]?.payload.state as { open: boolean }).open, true);
  assert.equal(runtime.getState().objects?.hall_door?.state?.open, true);
  const hidden = await runtime.handlePlayerAction({
    id: "inspect-hidden", sessionId: "demo", actorId: "player", type: "action", parameters: { intent: "inspect", targetId: "hidden_note" },
  });
  assert.equal(hidden.events[0]?.payload.reason, "inspect_target_unavailable");
});
