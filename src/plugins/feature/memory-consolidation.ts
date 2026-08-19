import { Service, type Context } from "@deepseek-ai/cordis";
import type { MemoryConsolidationGenerator, MemoryConsolidationStore } from "../../cif/memory-consolidator.js";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { DurableJobQueue } from "../../core/durable-jobs.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import { MemoryConsolidationWorker } from "../../cif/memory-consolidator.js";

export const WORLD_MEMORY_CONSOLIDATION_CAPABILITY = "world.memoryConsolidation";

export interface MemoryConsolidationController {
  drain(sessionId: string): Promise<number>;
}

export interface MemoryConsolidationPluginDependencies {
  sessionId: string;
  jobs: DurableJobQueue;
  store: MemoryConsolidationStore;
  generator: MemoryConsolidationGenerator;
  commands: CommandGateway;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

class MemoryConsolidationControllerService extends Service implements MemoryConsolidationController {
  public constructor(ctx: Context, private readonly controller: MemoryConsolidationController) { super(ctx, "worldMemoryConsolidation"); }
  public drain(sessionId: string) { return this.controller.drain(sessionId); }
}

/** Owns L1 memory-job delivery; the CIF hot path remains the atomic producer. */
export function createMemoryConsolidationPlugin(dependencies: MemoryConsolidationPluginDependencies): CordisGamePluginDefinition {
  const worker = new MemoryConsolidationWorker(dependencies.jobs, dependencies.store, dependencies.generator);
  const controller: MemoryConsolidationController = { drain: (sessionId) => worker.drain(sessionId) };
  const report = dependencies.onError ?? ((error: unknown) => console.error("memory consolidation failed", error));
  const intervalMs = dependencies.intervalMs ?? 30_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error("memory_consolidation_interval_invalid");
  return {
    manifest: {
      id: "feature.memory-consolidation", version: "1.0.0", configVersion: 1,
      requires: ["world.jobs", "world.commandGateway"],
      provides: [{ id: WORLD_MEMORY_CONSOLIDATION_CAPABILITY, serviceKey: "worldMemoryConsolidation" }],
      ownsJobs: ["memory.l1"],
    },
    implementation: (ctx: Context) => {
      new MemoryConsolidationControllerService(ctx, controller);
      ctx.effect(() => {
        const wake = () => { void controller.drain(dependencies.sessionId).catch(report); };
        const unsubscribe = dependencies.commands.subscribe(() => wake());
        wake();
        const interval = setInterval(wake, intervalMs);
        interval.unref();
        return () => { unsubscribe(); clearInterval(interval); };
      });
    },
  };
}
