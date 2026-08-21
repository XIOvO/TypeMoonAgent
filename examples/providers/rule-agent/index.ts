import { defineAgentProvider } from "agent-game-runtime/sdk";
import type {
  AgentProvider,
  AgentProviderAction,
  AgentProviderObservation,
  BindingQuery,
} from "agent-game-runtime/sdk";

export interface RuleAgentProviderOptions {
  readonly id?: string;
  readonly agentProfile?: string;
  readonly providerHint?: string;
  readonly requiredTags?: readonly string[];
  readonly utterance?: string;
  readonly alertUtterance?: string;
}

export function createRuleAgentProvider(
  options: RuleAgentProviderOptions = {},
): AgentProvider {
  const id = options.id ?? "example.rule-agent";
  const agentProfile = options.agentProfile ?? "rule";
  const requiredTags = [...(options.requiredTags ?? [])];
  const utterance = options.utterance ?? "I understand. I will stay with the plan.";
  const alertUtterance = options.alertUtterance ?? "I am alert and ready.";

  return defineAgentProvider({
    id,
    supports(query: BindingQuery): boolean {
      return query.agentProfile === agentProfile
        && (options.providerHint === undefined || query.providerHint === options.providerHint)
        && requiredTags.every((tag) => query.tags?.includes(tag) ?? false);
    },
    async run(observation: AgentProviderObservation): Promise<AgentProviderAction> {
      const alert = observation.selfState.mood === "alert"
        || observation.incomingAction.type === "combat";
      return {
        id: id + ":" + observation.id,
        sessionId: observation.sessionId,
        actorId: observation.recipientId,
        observationId: observation.id,
        utterance: alert ? alertUtterance : utterance,
        requests: [],
      };
    },
  });
}

export const ruleAgentProvider = createRuleAgentProvider();
