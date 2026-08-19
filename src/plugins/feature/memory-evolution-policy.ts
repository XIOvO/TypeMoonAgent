import { randomUUID } from "node:crypto";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { EpisodeMemory } from "../../cif/types.js";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { DurableJobQueue } from "../../core/durable-jobs.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";

export const WORLD_MEMORY_EVOLUTION_POLICY_CAPABILITY = "world.memoryEvolutionPolicy";
export interface MemoryEvolutionPolicyController { evaluate(sessionId: string): number; }
export interface MemoryEvolutionPolicyStore { listEpisodeMemories(sessionId: string, characterId: string): EpisodeMemory[]; }
export interface MemoryEvolutionPolicyDependencies {
  sessionId: string;
  jobs: DurableJobQueue;
  store: MemoryEvolutionPolicyStore;
  commands: CommandGateway;
  characterIds: () => readonly string[];
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

class MemoryEvolutionPolicyService extends Service implements MemoryEvolutionPolicyController {
  public constructor(ctx: Context, private readonly controller: MemoryEvolutionPolicyController) { super(ctx, "worldMemoryEvolutionPolicy"); }
  public evaluate(sessionId: string): number { return this.controller.evaluate(sessionId); }
}

/**
 * Conservative bridge policy: when an owner has at least two active L1
 * memories, queue the newest one for L2. Durable dedupe makes repeated scans
 * harmless; richer topic, salience, and scene policies can replace this later.
 */
export function createMemoryEvolutionPolicyPlugin(dependencies: MemoryEvolutionPolicyDependencies): CordisGamePluginDefinition {
  const controller: MemoryEvolutionPolicyController = {
    evaluate(sessionId: string): number {
      const now = new Date().toISOString();
      let created = 0;
      dependencies.jobs.transaction(() => {
        for (const characterId of new Set(dependencies.characterIds())) {
          const episodes = dependencies.store.listEpisodeMemories(sessionId, characterId).filter((episode) => episode.status === "active")
            .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id));
          const trigger = episodes[0];
          if (!trigger || episodes.length < 2) continue;
          dependencies.jobs.enqueue({ id: randomUUID(), sessionId, kind: "memory.l2", dedupeKey: `${characterId}:${trigger.id}`,
            payload: { characterId, triggerEpisodeId: trigger.id }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: now, createdAt: now });
          created += 1;
        }
      });
      return created;
    },
  };
  const report = dependencies.onError ?? ((error: unknown) => console.error("memory evolution policy failed", error));
  const intervalMs = dependencies.intervalMs ?? 30_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error("memory_evolution_policy_interval_invalid");
  return { manifest: { id: "feature.memory-evolution-policy", version: "1.0.0", configVersion: 1, requires: ["world.jobs", "world.commandGateway", "world.cifPatterns"], provides: [{ id: WORLD_MEMORY_EVOLUTION_POLICY_CAPABILITY, serviceKey: "worldMemoryEvolutionPolicy" }] }, implementation: (ctx: Context) => {
    new MemoryEvolutionPolicyService(ctx, controller);
    ctx.effect(() => {
      const evaluate = () => { try { controller.evaluate(dependencies.sessionId); } catch (error) { report(error); } };
      const unsubscribe = dependencies.commands.subscribe(() => evaluate());
      evaluate();
      const interval = setInterval(evaluate, intervalMs); interval.unref();
      return () => { unsubscribe(); clearInterval(interval); };
    });
  } };
}
