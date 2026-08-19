import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { GameEvent, GameState } from "../core/contracts.js";
import { SqliteTurnCommitter } from "../persistence/turn-commit.js";
import { ChapterAssessmentScheduler, ChapterAssessmentWorker, type ChapterAssessmentGenerator } from "./chapter-assessment.js";
import { StoryChapterPackageService } from "./chapter-packages.js";
import { fuyukiValidationPackage } from "./content/fuyuki-validation-package.js";

test("chapter assessment is durably scheduled from an L0 event and accepts only cited analysis", async () => {
  const repository = new SqliteCifRepository();
  const chapters = new StoryChapterPackageService(repository);
  repository.transaction(() => chapters.commitEntry({ sessionId: "demo", playerId: "player", chapter: fuyukiValidationPackage, now: "2026-08-14T10:00:00Z", checkpointRevision: 0 }));
  const event: GameEvent = { id: "e-artifact", sessionId: "demo", createdAt: "2026-08-14T10:01:00Z", sequence: 1, type: "object_interacted", payload: { characterId: "player", objectId: "unknown_artifact" }, causation: { playerActionId: "a-artifact" }, stateRevision: 1 };
  const world: GameState = { sessionId: "demo", revision: 1, characters: { player: { id: "player", locationId: "fuyuki", mood: "calm" } }, locations: { fuyuki: { id: "fuyuki", exits: [] } } };
  new SqliteTurnCommitter(repository, undefined, undefined, new ChapterAssessmentScheduler(repository)).commit({ actionId: "a-artifact", sessionId: "demo", stateRevision: 1, worldState: world, events: [event], recipientsByEventId: new Map([[event.id, ["player"]]]) });
  let receivedEventIds: string[] = [];
  const generator: ChapterAssessmentGenerator = { async generate(input) {
    receivedEventIds = input.confirmedEvents.map((item) => item.id);
    return {
      shouldApply: true, sourceEventIds: ["e-artifact"], canonSourceFragmentIds: ["canon:validation:fuyuki"],
      changedFact: { factKey: "fuyuki.artifact.status", value: { secured: true }, canonBaseline: { secured: false } },
      divergence: { significance: "major", affectedScope: "chapter", knownImpactNodeIds: ["fuyuki:artifact-path"], pendingImpactChapterIds: [], status: "active", rationale: "The confirmed interaction changes the referenced artifact condition." },
      pendingImpactChapterIds: ["fuyuki:aftermath"], rationale: "The event and canon source support a local branch difference.",
    };
  } };
  assert.equal(await new ChapterAssessmentWorker(repository, generator, { getFragmentsByIds: (ids) => ids.map((id) => ({ id, text: "Canon validation fragment." })) }).processNext("demo", new Date("2026-08-14T10:02:00Z")), true);
  assert.deepEqual(receivedEventIds, ["e-artifact"]);
  assert.deepEqual(repository.getBranchFact("demo", "fuyuki.artifact.status")?.value, { secured: true });
  assert.deepEqual(repository.listWorldlineDivergences("demo")[0]?.pendingImpactChapterIds, ["fuyuki:aftermath"]);
  repository.close();
});

test("chapter assessment cannot write a fact outside its package policy", async () => {
  const repository = new SqliteCifRepository();
  const chapters = new StoryChapterPackageService(repository);
  repository.transaction(() => chapters.commitEntry({ sessionId: "demo", playerId: "player", chapter: fuyukiValidationPackage, now: "2026-08-14T10:00:00Z", checkpointRevision: 0 }));
  const event: GameEvent = { id: "e-forbidden", sessionId: "demo", createdAt: "2026-08-14T10:01:00Z", sequence: 1, type: "object_interacted", payload: { characterId: "player", objectId: "unknown_artifact" }, causation: { playerActionId: "a-forbidden" }, stateRevision: 1 };
  const world: GameState = { sessionId: "demo", revision: 1, characters: { player: { id: "player", locationId: "fuyuki", mood: "calm" } }, locations: { fuyuki: { id: "fuyuki", exits: [] } } };
  new SqliteTurnCommitter(repository, undefined, undefined, new ChapterAssessmentScheduler(repository)).commit({ actionId: "a-forbidden", sessionId: "demo", stateRevision: 1, worldState: world, events: [event], recipientsByEventId: new Map([[event.id, ["player"]]]) });
  const generator: ChapterAssessmentGenerator = { async generate() { return {
    shouldApply: true, sourceEventIds: ["e-forbidden"], canonSourceFragmentIds: ["canon:validation:fuyuki"],
    changedFact: { factKey: "goetia.final_plan", value: { exposed: true }, canonBaseline: { exposed: false } },
    divergence: { significance: "major", affectedScope: "chapter", knownImpactNodeIds: ["fuyuki:artifact-path"], pendingImpactChapterIds: [], status: "active", rationale: "This must be rejected because the chapter never authorized this fact." },
    pendingImpactChapterIds: [], rationale: "This must be rejected because the chapter never authorized this fact.",
  }; } };
  assert.equal(await new ChapterAssessmentWorker(repository, generator, { getFragmentsByIds: (ids) => ids.map((id) => ({ id, text: "Canon validation fragment." })) }).processNext("demo", new Date("2026-08-14T10:02:00Z")), true);
  assert.equal(repository.getBranchFact("demo", "goetia.final_plan"), undefined);
  assert.deepEqual(repository.listWorldlineDivergences("demo"), []);
  repository.close();
});
