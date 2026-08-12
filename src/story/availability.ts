import type { CharacterAvailability } from "./types.js";

/** MVP content data; future arcs can load this same shape from JSON or SQLite. */
export const chaldeaOpeningAvailability: CharacterAvailability[] = [{
  id: "chaldea-arrival-mash",
  characterId: "mash",
  storyPointIds: ["chaldea:arrival"],
  signalTypes: ["opening_confirmed"],
  locations: ["chaldea_hall"],
  baseWeight: 0.8,
  modifiers: { playerAlone: 0.2 },
  introductionReason: "story_trigger",
}];
