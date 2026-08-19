import type { GameEvent } from "../core/contracts.js";

/** Deterministic tags from Runtime-confirmed events, never an LLM judgment. */
export type CifContextTag = "immediate_danger" | "battle_aftermath" | "major_confirmed" | "scene_transition";

export function contextTagsForConfirmedEvent(event: GameEvent): CifContextTag[] {
  if (event.type === "battle_started") return ["immediate_danger", "major_confirmed"];
  if (event.type === "battle_finished") return ["battle_aftermath", "major_confirmed"];
  if (event.type === "character_moved") return ["scene_transition"];
  return [];
}

export function importanceForContextTags(tags: readonly CifContextTag[]): number {
  return tags.includes("major_confirmed") ? 0.9 : tags.length ? 0.55 : 0.2;
}
