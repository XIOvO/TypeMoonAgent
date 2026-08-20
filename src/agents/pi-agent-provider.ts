import type { AgentProvider, BindingQuery } from "../agent/provider.js";
import type { Observation, AgentAction, CombinedTurnProposal, RawPlayerInput } from "../core/contracts.js";
import type { CombinedTurnRunner } from "../core/agent-runner.js";
import type { PiAgentRunner } from "./pi-agent-runner.js";

export interface PiAgentProviderOptions {
  id?: string;
  agentProfile?: string;
  providerHint?: string;
}

/**
 * Agent-provider adapter for Pi. All Pi tool restrictions and result checks
 * remain owned by PiAgentRunner; this class only supplies registry selection.
 */
export class PiAgentProvider implements AgentProvider, CombinedTurnRunner {
  public readonly id: string;
  private readonly agentProfile: string;
  private readonly providerHint?: string;

  public constructor(
    private readonly runner: Pick<PiAgentRunner, "run" | "runCombined">,
    options: PiAgentProviderOptions = {},
  ) {
    this.id = options.id ?? "agent.pi";
    this.agentProfile = options.agentProfile ?? "pi";
    this.providerHint = options.providerHint;
  }

  public supports(query: BindingQuery): boolean {
    return query.agentProfile === this.agentProfile
      && (this.providerHint === undefined || query.providerHint === this.providerHint);
  }

  public run(observation: Observation): Promise<AgentAction> {
    return this.runner.run(observation);
  }

  public runCombined(observation: Observation, input: RawPlayerInput): Promise<CombinedTurnProposal> {
    return this.runner.runCombined(observation, input);
  }
}
