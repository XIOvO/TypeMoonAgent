import type { LegacyAgentAction } from "../protocol/agent-action.js";
import type { LegacyObservation } from "../protocol/observation.js";

/** The v0.2 self-state shape retained by the current Agent compatibility path. */
export interface AgentProviderCharacterState {
  id: string;
  locationId: string;
  mood: "calm" | "alert";
}

export type AgentProviderObservation = LegacyObservation<AgentProviderCharacterState>;
export type AgentProviderAction = LegacyAgentAction;

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
  run(observation: AgentProviderObservation): Promise<AgentProviderAction>;
}
