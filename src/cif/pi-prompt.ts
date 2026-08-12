import type { Observation } from "../core/contracts.js";
import type { CharacterContext } from "./types.js";

/**
 * Keeps the prompt payload explicit and inspectable. The character context is
 * a subjective CIF view; Observation remains the only source of scene facts.
 */
export function buildCifPiPrompt(observation: Observation, context: CharacterContext): string {
  return JSON.stringify({
    task: "Respond to this turn as the character and submit exactly one game action.",
    observation,
    cifContext: {
      identity: context.identity.map(({ section, content }) => ({ section, content })),
      runtimeState: context.runtimeState,
      relevantEvidence: context.evidence.map(({ id, kind, content, reliability, importance }) => ({ id, kind, content, reliability, importance })),
      epistemicStates: context.epistemicStates.map(({ proposition, status, confidence }) => ({ proposition, status, confidence })),
      interpretiveModels: context.interpretiveModels.map(({ kind, targetId, content, activation }) => ({ kind, targetId, content, activation })),
    },
  });
}
