import type { AgentAction, CombinedTurnProposal, Observation, RawPlayerInput } from "./contracts.js";

/** Core boundary: the Runtime depends on this interface, not on a model provider. */
export interface AgentRunner {
  run(observation: Observation): Promise<AgentAction>;
}

/** Resolves a character's runner without making Runtime own provider bindings. */
export interface AgentRunnerResolver {
  resolve(characterId: string): AgentRunner | undefined;
}

export type AgentRunnerSource = Record<string, AgentRunner> | AgentRunnerResolver;

/** Compatibility adapter for the v0.2 character-ID-to-runner constructor input. */
export function asAgentRunnerResolver(source: AgentRunnerSource): AgentRunnerResolver {
  if (isAgentRunnerResolver(source)) return source;
  return { resolve: (characterId) => source[characterId] };
}

function isAgentRunnerResolver(source: AgentRunnerSource): source is AgentRunnerResolver {
  return typeof (source as { resolve?: unknown }).resolve === "function";
}

/** Optional fast path for normal freeform social turns. */
export interface CombinedTurnRunner extends AgentRunner {
  runCombined(observation: Observation, input: RawPlayerInput): Promise<CombinedTurnProposal>;
}

export function isCombinedTurnRunner(runner: AgentRunner): runner is CombinedTurnRunner {
  return "runCombined" in runner && typeof runner.runCombined === "function";
}
