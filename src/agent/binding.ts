import type { BindingQuery } from "./provider.js";
import type { AgentRunner, AgentRunnerResolver } from "../core/agent-runner.js";
import { AgentRegistry } from "./registry.js";

/**
 * Per-character provider selection data. It describes capabilities rather than
 * mapping a character ID to a concrete provider implementation.
 */
export interface CharacterAgentBinding {
  agentProfile?: string;
  tags?: readonly string[];
  providerHint?: string;
}

export type CharacterAgentBindings = Readonly<Record<string, CharacterAgentBinding>>;

/** Builds the registry input while retaining character identity for observability. */
export function createBindingQuery(characterId: string, binding: CharacterAgentBinding = {}): BindingQuery {
  return {
    characterId,
    ...(binding.agentProfile === undefined ? {} : { agentProfile: binding.agentProfile }),
    ...(binding.tags === undefined ? {} : { tags: [...binding.tags] }),
    ...(binding.providerHint === undefined ? {} : { providerHint: binding.providerHint }),
  };
}

/** Bridges declarative character bindings into the Runtime's narrow resolver port. */
export class RegistryAgentRunnerResolver implements AgentRunnerResolver {
  public constructor(
    private readonly registry: AgentRegistry,
    private readonly bindings: CharacterAgentBindings,
  ) {}

  public resolve(characterId: string): AgentRunner | undefined {
    const binding = this.bindings[characterId];
    return binding ? this.registry.tryResolve(createBindingQuery(characterId, binding)) : undefined;
  }
}
