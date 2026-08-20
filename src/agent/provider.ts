import type { AgentAction, Observation } from "../core/contracts.js";

/** Declarative input used to select a provider without hard-coding character IDs. */
export interface BindingQuery {
  characterId: string;
  agentProfile?: string;
  tags?: readonly string[];
  providerHint?: string;
}

/** A game agent provider; model SDKs belong only in concrete adapters. */
export interface AgentProvider {
  readonly id: string;
  supports(query: BindingQuery): boolean;
  run(observation: Observation): Promise<AgentAction>;
}
