import type { CifContextTag } from "./context-tags.js";
import type { IdentitySection } from "./types.js";

/** Always-present personality base. Scene routing may add, never remove, these sections. */
export const CORE_IDENTITY_SECTIONS: readonly IdentitySection[] = [
  "character_brief", "self_model", "core_schema", "needs", "values", "practical_judgment", "voice_embodiment", "expression_filter",
];

export function identitySectionsForContextTags(tags: readonly CifContextTag[]): readonly IdentitySection[] {
  return tags.includes("major_confirmed") || tags.includes("immediate_danger") || tags.includes("battle_aftermath")
    ? ["commitment", "appraisal_tendencies", "emotional_pattern", "growth_boundaries"]
    : [];
}

export function uniqueIdentitySections(sections: readonly IdentitySection[]): IdentitySection[] {
  return [...new Set(sections)];
}
