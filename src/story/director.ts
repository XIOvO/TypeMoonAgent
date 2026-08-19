import type { CharacterIntroductionAuthorizer, GameRuntime } from "../core/runtime.js";
import type { CharacterAppearanceFactors } from "../cif/types.js";
import type { CharacterAppearanceRecommendation, CharacterAvailability, StorySignal } from "./types.js";

/** Read-only seam so Story Director can use the current CIF/history projection. */
export interface CharacterAppearanceFactorsProvider {
  getAppearanceFactors(sessionId: string, characterId: string): CharacterAppearanceFactors | undefined;
}

/** Deterministic coordinator: recommends candidates from data, never invents a beat. */
export class StoryDirector {
  public constructor(
    private readonly availability: readonly CharacterAvailability[],
    private readonly authorizer: CharacterIntroductionAuthorizer,
    private readonly factors?: CharacterAppearanceFactorsProvider,
  ) {}

  public recommend(runtime: GameRuntime, signal: StorySignal): CharacterAppearanceRecommendation[] {
    if (signal.sessionId !== runtime.getState().sessionId) throw new Error("story_signal_session_mismatch");
    const world = runtime.getState();
    const locationId = signal.locationId ?? (signal.actorId ? world.characters[signal.actorId]?.locationId : undefined);
    if (!locationId) return [];
    const charactersAtLocation = Object.values(world.characters).filter((character) => character.locationId === locationId);
    const playerAlone = charactersAtLocation.length === 1 && charactersAtLocation[0]?.id === "player";
    return this.availability
      .filter((rule) => rule.storyPointIds.includes(signal.storyPointId))
      .filter((rule) => rule.signalTypes.includes(signal.type) && rule.locations.includes(locationId))
      .filter((rule) => !world.characters[rule.characterId])
      .filter((rule) => this.authorizer.hasPublishedInitialization(signal.sessionId, rule.characterId))
      .map((rule) => ({ rule, factors: this.factors?.getAppearanceFactors(signal.sessionId, rule.characterId) }))
      .filter(({ factors }) => factors?.availability !== "blocked")
      .map(({ rule, factors }) => this.toRecommendation(rule, locationId, playerAlone, signal, factors))
      .sort((left, right) => right.score - left.score || left.characterId.localeCompare(right.characterId));
  }

  /** A selected recommendation still crosses Runtime's full authority gate. */
  public async introduce(runtime: GameRuntime, signal: StorySignal, recommendation: CharacterAppearanceRecommendation): Promise<void> {
    const current = this.recommend(runtime, signal).find((candidate) => candidate.availabilityId === recommendation.availabilityId && candidate.characterId === recommendation.characterId);
    if (!current) throw new Error("story_recommendation_no_longer_available");
    await runtime.introduceCharacter({
      id: `story:${signal.id}:introduce:${current.characterId}`, sessionId: signal.sessionId, characterId: current.characterId,
      locationId: current.locationId, reason: current.introductionReason, mood: "calm",
    });
  }

  private toRecommendation(
    rule: CharacterAvailability,
    locationId: string,
    playerAlone: boolean,
    signal: StorySignal,
    factors?: CharacterAppearanceFactors,
  ): CharacterAppearanceRecommendation {
    const contextModifier = playerAlone ? (rule.modifiers?.playerAlone ?? 0) : (rule.modifiers?.playerHasCompanion ?? 0);
    const tagWeights = Object.entries(factors?.responseWeights ?? {}).filter(([tag]) => signal.tags?.includes(tag));
    const responseModifier = tagWeights.reduce((total, [, weight]) => total + weight, 0);
    const relationshipModifier = signal.actorId ? (factors?.relationshipWeights[signal.actorId] ?? 0) : 0;
    const availabilityModifier = factors?.availability === "busy" ? -0.35 : 0;
    const reasons = ["story_point_matches", "signal_matches", "location_matches", "published_and_absent", playerAlone ? "player_alone" : "player_has_companion"];
    if (factors?.activeGoals.length) reasons.push(`active_goals:${factors.activeGoals.join(",")}`);
    if (factors?.availability === "busy") reasons.push("currently_busy");
    for (const [tag] of tagWeights) reasons.push(`response_to:${tag}`);
    if (relationshipModifier !== 0 && signal.actorId) reasons.push(`relationship_to:${signal.actorId}`);
    return {
      availabilityId: rule.id, characterId: rule.characterId, locationId,
      score: roundScore(rule.baseWeight + contextModifier + responseModifier + relationshipModifier + availabilityModifier),
      reasons,
      introductionReason: rule.introductionReason,
    };
  }
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
