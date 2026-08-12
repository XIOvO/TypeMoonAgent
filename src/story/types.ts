export interface StorySignal {
  id: string;
  sessionId: string;
  storyPointId: string;
  type: "opening_confirmed" | "location_entered" | "world_time_advanced";
  actorId?: string;
  locationId?: string;
  /** Objective tags emitted by world/rule processing, never inferred here. */
  tags?: string[];
}

export interface StoryTriggerResult {
  triggerId: string;
  introducedCharacterIds: string[];
}

/** Data-only rule describing when a character is a plausible local candidate. */
export interface CharacterAvailability {
  id: string;
  characterId: string;
  storyPointIds: string[];
  signalTypes: StorySignal["type"][];
  locations: string[];
  baseWeight: number;
  modifiers?: { playerAlone?: number; playerHasCompanion?: number };
  introductionReason: "story_trigger" | "summon" | "encounter" | "gm_request";
}

export interface CharacterAppearanceRecommendation {
  availabilityId: string;
  characterId: string;
  locationId: string;
  score: number;
  reasons: string[];
  introductionReason: CharacterAvailability["introductionReason"];
}
