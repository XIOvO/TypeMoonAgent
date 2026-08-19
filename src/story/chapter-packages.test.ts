import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { GameEvent, GameState } from "../core/contracts.js";
import { GameRuntime } from "../core/runtime.js";
import { SqliteTurnCommitter } from "../persistence/turn-commit.js";
import { BranchWorldlineProjector } from "./branch-projector.js";
import { StoryChapterPackageService } from "./chapter-packages.js";
import { fuyukiValidationPackage } from "./content/fuyuki-validation-package.js";

test("any entered chapter package advances only its active node; Fuyuki validates the reusable path", () => {
  const repository = new SqliteCifRepository();
  const packages = new StoryChapterPackageService(repository);
  repository.transaction(() => packages.commitEntry({ sessionId: "demo", playerId: "player", chapter: fuyukiValidationPackage, now: "2026-08-14T10:00:00Z", checkpointRevision: 0 }));
  const committer = new SqliteTurnCommitter(repository, undefined, new BranchWorldlineProjector(repository, packages));
  const world: GameState = { sessionId: "demo", revision: 1, characters: { player: { id: "player", locationId: "fuyuki", mood: "calm" } }, locations: { fuyuki: { id: "fuyuki", exits: [] } } };
  const commit = (event: GameEvent) => committer.commit({ actionId: event.causation.playerActionId!, sessionId: "demo", stateRevision: event.stateRevision, worldState: { ...world, revision: event.stateRevision }, events: [event], recipientsByEventId: new Map([[event.id, ["player"]]]) });
  commit({ id: "rescue-too-early", sessionId: "demo", createdAt: "2026-08-14T10:01:00Z", sequence: 1, type: "object_interacted", payload: { objectId: "olga_rescue_device" }, causation: { playerActionId: "a-early" }, stateRevision: 1 });
  assert.equal(repository.getBranchProgress("demo", "player", "main", "fuyuki")?.activeNodeId, "fuyuki:secure-gate");
  commit({ id: "secure-gate", sessionId: "demo", createdAt: "2026-08-14T10:02:00Z", sequence: 2, type: "object_interacted", payload: { objectId: "fuyuki_singularity_gate" }, causation: { playerActionId: "a-gate" }, stateRevision: 2 });
  assert.equal(repository.getBranchProgress("demo", "player", "main", "fuyuki")?.activeNodeId, "fuyuki:rescue");
  commit({ id: "rescue", sessionId: "demo", createdAt: "2026-08-14T10:03:00Z", sequence: 3, type: "object_interacted", payload: { objectId: "olga_rescue_device" }, causation: { playerActionId: "a-rescue" }, stateRevision: 3 });
  assert.equal(repository.getBranchProgress("demo", "player", "main", "fuyuki")?.status, "completed");
  assert.equal(repository.getBranchFact("demo", "olga_marie.status")?.value.status, "alive");
  assert.equal(repository.listWorldlineDivergences("demo")[0]?.changedFactKey, "olga_marie.status");
  repository.close();
});

test("a failed chapter entry rolls back its chapter context and L0 event together", async () => {
  const repository = new SqliteCifRepository();
  const packages = new StoryChapterPackageService(repository);
  const world: GameState = { sessionId: "demo", revision: 0, characters: { player: { id: "player", locationId: "fuyuki", mood: "calm" } }, locations: { fuyuki: { id: "fuyuki", exits: [] } } };
  const runtime = new GameRuntime(world, {}, new SqliteTurnCommitter(repository), undefined, 0, {
    commitEntry(input) {
      packages.commitEntry(input);
      throw new Error("chapter_entry_write_failed");
    },
  });
  await assert.rejects(runtime.enterChapter({ id: "chapter-fail", sessionId: "demo", playerId: "player", mode: "new", chapter: fuyukiValidationPackage }), /chapter_entry_write_failed/);
  assert.equal(repository.getStoryContext("demo"), undefined);
  assert.equal(repository.countObjectiveHistory("demo"), 0);
  assert.equal(runtime.getState().revision, 0);
  assert.deepEqual(runtime.getEvents(), []);
  repository.close();
});
