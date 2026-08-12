import type { AgentAction, CombinedTurnProposal, Observation, RawPlayerInput } from "./contracts.js";

/** Core boundary: the Runtime depends on this interface, not on a model provider. */
export interface AgentRunner {
  run(observation: Observation): Promise<AgentAction>;
}

/** Optional fast path for normal freeform social turns. */
export interface CombinedTurnRunner extends AgentRunner {
  runCombined(observation: Observation, input: RawPlayerInput): Promise<CombinedTurnProposal>;
}

export function isCombinedTurnRunner(runner: AgentRunner): runner is CombinedTurnRunner {
  return "runCombined" in runner && typeof runner.runCombined === "function";
}
