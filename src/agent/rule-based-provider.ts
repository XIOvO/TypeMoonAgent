import type { AgentAction, Observation } from "../core/contracts.js";
import type { AgentProvider, BindingQuery } from "./provider.js";

export interface RuleBasedAgentProviderOptions {
  id?: string;
  agentProfile?: string;
  providerHint?: string;
  utterance?: string;
}

/** A deterministic, credential-free provider for reference turns and tests. */
export class RuleBasedAgentProvider implements AgentProvider {
  public readonly id: string;
  private readonly agentProfile: string;
  private readonly providerHint?: string;
  private readonly utterance: string;

  public constructor(options: RuleBasedAgentProviderOptions = {}) {
    this.id = options.id ?? "agent.rule";
    this.agentProfile = options.agentProfile ?? "rule";
    this.providerHint = options.providerHint;
    this.utterance = options.utterance ?? "收到。我会留意当前情况。";
  }

  public supports(query: BindingQuery): boolean {
    return query.agentProfile === this.agentProfile
      && (this.providerHint === undefined || query.providerHint === this.providerHint);
  }

  public async run(observation: Observation): Promise<AgentAction> {
    return {
      id: `rule:${observation.id}`,
      sessionId: observation.sessionId,
      actorId: observation.recipientId,
      observationId: observation.id,
      utterance: this.utterance,
      requests: [],
    };
  }
}
