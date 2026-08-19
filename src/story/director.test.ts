import assert from "node:assert/strict";
import test from "node:test";
import { GameRuntime } from "../core/runtime.js";
import { chaldeaOpeningAvailability } from "./availability.js";
import { StoryDirector } from "./director.js";

const world = () => ({
  sessionId: "demo", revision: 0,
  characters: { player: { id: "player", locationId: "chaldea_hall", mood: "calm" as const } },
  locations: { chaldea_hall: { id: "chaldea_hall", exits: [] } },
});

test("Chaldea opening recommends published Mash and Runtime introduces the selected candidate once", async () => {
  const authorizer = { hasPublishedInitialization: (_sessionId: string, id: string) => id === "mash" };
  const runtime = new GameRuntime(world(), {}, undefined, authorizer);
  const director = new StoryDirector(chaldeaOpeningAvailability, authorizer);
  const signal = { id: "opening-1", sessionId: "demo", storyPointId: "chaldea:arrival", type: "opening_confirmed" as const, actorId: "player" };
  const [recommendation] = director.recommend(runtime, signal);
  assert.equal(recommendation?.characterId, "mash");
  assert.equal(recommendation?.score, 1);
  await director.introduce(runtime, signal, recommendation!);
  assert.equal(runtime.getState().characters.mash?.locationId, "chaldea_hall");
  assert.deepEqual(director.recommend(runtime, signal), []);
  assert.equal(runtime.getEvents().filter((event) => event.type === "character_introduced").length, 1);
});

test("Chaldea opening does not recommend an unpublished character", () => {
  const authorizer = { hasPublishedInitialization: () => false };
  const runtime = new GameRuntime(world(), {}, undefined, authorizer);
  assert.deepEqual(new StoryDirector(chaldeaOpeningAvailability, authorizer).recommend(runtime, { id: "opening-1", sessionId: "demo", storyPointId: "chaldea:arrival", type: "opening_confirmed" }), []);
  assert.equal(runtime.getState().characters.mash, undefined);
});

test("CIF/history appearance factors adjust a canon-qualified recommendation", () => {
  const authorizer = { hasPublishedInitialization: () => true };
  const runtime = new GameRuntime(world(), {}, undefined, authorizer);
  const factors = {
    getAppearanceFactors: () => ({
      sessionId: "demo", characterId: "mash", activeGoals: ["protect_player"],
      responseWeights: { player_in_danger: 0.4 }, relationshipWeights: { player: 0.2 },
      availability: "free" as const, updatedAt: "2026-08-12T00:00:00Z",
    }),
  };
  const director = new StoryDirector(chaldeaOpeningAvailability, authorizer, factors);
  const [recommendation] = director.recommend(runtime, {
    id: "danger-1", sessionId: "demo", storyPointId: "chaldea:arrival", type: "opening_confirmed",
    actorId: "player", tags: ["player_in_danger"],
  });
  assert.equal(recommendation?.score, 1.6);
  assert.ok(recommendation?.reasons.includes("response_to:player_in_danger"));
  assert.ok(recommendation?.reasons.includes("relationship_to:player"));
  assert.ok(recommendation?.reasons.includes("active_goals:protect_player"));
});

test("a blocked character is not recommended even when canon-qualified", () => {
  const authorizer = { hasPublishedInitialization: () => true };
  const runtime = new GameRuntime(world(), {}, undefined, authorizer);
  const factors = { getAppearanceFactors: () => ({
    sessionId: "demo", characterId: "mash", activeGoals: [], responseWeights: {}, relationshipWeights: {},
    availability: "blocked" as const, updatedAt: "2026-08-12T00:00:00Z",
  }) };
  assert.deepEqual(new StoryDirector(chaldeaOpeningAvailability, authorizer, factors).recommend(runtime, {
    id: "opening-1", sessionId: "demo", storyPointId: "chaldea:arrival", type: "opening_confirmed",
  }), []);
});
