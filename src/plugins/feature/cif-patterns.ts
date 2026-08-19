import { Service, type Context } from "@deepseek-ai/cordis";
import type { PatternConsolidationAuditor, PatternConsolidationGenerator, PatternConsolidationStore, PatternPublicationPort } from "../../cif/pattern-consolidator.js";
import { PatternAuditWorker, PatternConsolidationWorker } from "../../cif/pattern-consolidator.js";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { DurableJobQueue } from "../../core/durable-jobs.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";

export const WORLD_CIF_PATTERNS_CAPABILITY = "world.cifPatterns";
export interface CifPatternsController { drain(sessionId: string): Promise<number>; }
export interface CifPatternsPluginDependencies { sessionId: string; jobs: DurableJobQueue; store: PatternConsolidationStore; generator: PatternConsolidationGenerator; auditor: PatternConsolidationAuditor; publisher: PatternPublicationPort; commands: CommandGateway; intervalMs?: number; onError?: (error: unknown) => void; }

class CifPatternsControllerService extends Service implements CifPatternsController {
  public constructor(ctx: Context, private readonly controller: CifPatternsController) { super(ctx, "worldCifPatterns"); }
  public drain(sessionId: string) { return this.controller.drain(sessionId); }
}

/** Owns draft-only L2 pattern analysis; publishing remains a separate reviewed capability. */
export function createCifPatternsPlugin(dependencies: CifPatternsPluginDependencies): CordisGamePluginDefinition {
  const worker = new PatternConsolidationWorker(dependencies.jobs, dependencies.store, dependencies.generator);
  const auditWorker = new PatternAuditWorker(dependencies.jobs, dependencies.store, dependencies.auditor, dependencies.publisher);
  const controller: CifPatternsController = { async drain(sessionId: string) { return await worker.drain(sessionId) + await auditWorker.drain(sessionId); } };
  const report = dependencies.onError ?? ((error: unknown) => console.error("CIF pattern consolidation failed", error));
  const intervalMs = dependencies.intervalMs ?? 60_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error("cif_patterns_interval_invalid");
  return { manifest: { id: "feature.cif-patterns", version: "1.1.0", configVersion: 2, requires: ["world.jobs", "world.commandGateway"], provides: [{ id: WORLD_CIF_PATTERNS_CAPABILITY, serviceKey: "worldCifPatterns" }], ownsJobs: ["memory.l2", "memory.l2.audit"] }, implementation: (ctx: Context) => {
    new CifPatternsControllerService(ctx, controller);
    ctx.effect(() => {
      const wake = () => { void controller.drain(dependencies.sessionId).catch(report); };
      const unsubscribe = dependencies.commands.subscribe(() => wake());
      wake();
      const interval = setInterval(wake, intervalMs); interval.unref();
      return () => { unsubscribe(); clearInterval(interval); };
    });
  } };
}
