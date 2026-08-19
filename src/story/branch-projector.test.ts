import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { GameEvent, GameState } from "../core/contracts.js";
import { SqliteTurnCommitter } from "../persistence/turn-commit.js";
import { BranchWorldlineProjector, type BranchProjectionRule } from "./branch-projector.js";

test("a confirmed branch event atomically updates progress, facts, divergence, and checkpoint", () => {
  const repository = new SqliteCifRepository();
  const rule: BranchProjectionRule = {
    id: "olga-survives",
    applies: (event) => event.type === "object_interacted" && event.payload.objectId === "olga_rescue_device",
    effects: () => ({
      fact: {
        factKey: "olga_marie.status", value: { status: "alive", locationId: "chaldea" }, canonBaseline: { status: "dead" },
        divergence: { significance: "critical", affectedScope: "global", knownImpactNodeIds: ["u-olga-origin"], pendingImpactChapterIds: ["lostbelt-prologue"], status: "active", rationale: "The player prevented the canonical death." },
      },
      progress: { contentType: "main", contentId: "fuyuki", activeNodeId: "fuyuki:next", status: "active", completedNodeIds: ["fuyuki:rescue"], divertedNodeIds: ["canon:olga-death"], blockedNodeIds: [] },
    }),
  };
  const projector = new BranchWorldlineProjector(repository, [rule]);
  projector.initialize({ sessionId: "demo", playerId: "player", canonAnchor: "fgo:2016:pre-fire", checkpointRevision: 0, updatedAt: "2026-08-14T00:00:00Z" }, [{
    sessionId: "demo", playerId: "player", contentType: "main", contentId: "fuyuki", status: "available", completedNodeIds: [], divertedNodeIds: [], blockedNodeIds: [], updatedAt: "2026-08-14T00:00:00Z",
  }]);
  const event: GameEvent = { id: "e-rescue", sessionId: "demo", createdAt: "2026-08-14T00:01:00Z", sequence: 1, type: "object_interacted", payload: { characterId: "player", objectId: "olga_rescue_device" }, causation: { playerActionId: "a-rescue" }, stateRevision: 1 };
  const world: GameState = { sessionId: "demo", revision: 1, characters: { player: { id: "player", locationId: "chaldea", mood: "calm" } }, locations: { chaldea: { id: "chaldea", exits: [] } } };
  new SqliteTurnCommitter(repository, undefined, projector).commit({ actionId: "a-rescue", sessionId: "demo", stateRevision: 1, worldState: world, events: [event], recipientsByEventId: new Map([[event.id, ["player"]]]) });
  assert.deepEqual(repository.getBranchFact("demo", "olga_marie.status")?.value, { status: "alive", locationId: "chaldea" });
  assert.deepEqual(repository.getBranchProgress("demo", "player", "main", "fuyuki"), {
    sessionId: "demo", playerId: "player", contentType: "main", contentId: "fuyuki", activeNodeId: "fuyuki:next", status: "active",
    completedNodeIds: ["fuyuki:rescue"], divertedNodeIds: ["canon:olga-death"], blockedNodeIds: [], updatedAt: "2026-08-14T00:01:00Z",
  });
  assert.deepEqual(repository.listWorldlineDivergences("demo")[0]?.pendingImpactChapterIds, ["lostbelt-prologue"]);
  assert.equal(repository.getStoryContext("demo")?.checkpointRevision, 1);
  repository.close();
});
