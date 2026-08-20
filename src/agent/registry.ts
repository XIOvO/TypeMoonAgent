import type { AgentProvider, BindingQuery } from "./provider.js";

/** Ordered provider registry; selection is declarative and never model-specific. */
export class AgentRegistry {
  private readonly providers = new Map<string, AgentProvider>();

  public register(provider: AgentProvider): void {
    if (this.providers.has(provider.id)) throw new Error("agent_provider_duplicate");
    this.providers.set(provider.id, provider);
  }

  public resolve(query: BindingQuery): AgentProvider {
    const provider = this.tryResolve(query);
    if (provider) return provider;
    throw new Error("agent_provider_not_found");
  }

  public tryResolve(query: BindingQuery): AgentProvider | undefined {
    for (const provider of this.providers.values()) if (provider.supports(query)) return provider;
    return undefined;
  }

  public unregister(providerId: string): void { this.providers.delete(providerId); }
  public list(): readonly AgentProvider[] { return [...this.providers.values()]; }
}
