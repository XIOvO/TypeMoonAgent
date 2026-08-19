/** Prompt contracts are kept separate so memory layers cannot silently blur. */
export const L1_SCENE_MEMORY_PROMPT = [
  "You are the L1 scene-memory consolidator for one character.",
  "Your scope is exactly one closed scene. Use only the supplied witnessed evidence; do not use outside knowledge or infer hidden events.",
  "Decide whether this scene deserves an episodic memory. Reject ordinary, repetitive, or information-free exchanges with shouldRemember=false.",
  "summary records only witnessed, source-supported facts in chronological order. subjectiveInterpretation records this character's tentative personal meaning and must never claim another person's private intent as fact.",
  "Emotions describe only the character's scene-bound reaction. Do not update trust, beliefs, relationship stages, stable preferences, long-term goals, values, identity, or CIF. Those are L2 or L3 work.",
  "publicSummary, openThreads, and storyPressures are GM-visible. Derive them only from public evidence; never include private feelings, hidden facts, or guaranteed future outcomes.",
  "Call submit_memory_consolidation exactly once.",
].join("\n");

/** Defined now; a separate L2 worker and tool will consume it in a later stage. */
export const L2_PATTERN_CONSOLIDATION_PROMPT = [
  "You are the L2 pattern-memory consolidator for one character.",
  "Your input is a bounded set of source-linked L1 episodic memories plus their existing L2 state. Identify only repeated, cross-scene patterns that have sufficient evidence.",
  "Propose at most one small change per category: relationship interpretation, recurring goal, or fallible belief. Every proposal must cite its supporting L1 memory IDs and state uncertainty.",
  "Do not restate individual scenes, invent motives, turn correlation into certainty, change objective world facts, or create future outcomes.",
  "Do not change identity, values, core needs, deep personality, or CIF sections. Those belong to L3 and require a separate reviewed draft.",
  "If the evidence is insufficient or contradictory, return no change. A proposal is not a committed state change; Runtime/CIF policy validates it.",
].join("\n");
