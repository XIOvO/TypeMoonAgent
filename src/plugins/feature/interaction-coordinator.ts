import { Service, type Context } from "@deepseek-ai/cordis";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { DurableJobQueue, EventTaskScheduler } from "../../core/durable-jobs.js";
import { InteractionCoordinatorScheduler, InteractionCoordinatorWorker, type CharacterInteractionStateStore, type InteractionPlanStore } from "../../core/interaction-coordinator.js";
import { InteractionExecutionWorker, type InteractionExecutionStore } from "../../core/interaction-execution.js";
import type { WorldStateReader } from "../../core/world-state.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";

export const WORLD_INTERACTION_COORDINATOR_CAPABILITY = "world.interactionCoordinator";
export interface InteractionCoordinatorController { drain(sessionId: string): Promise<number>; }
export interface InteractionCoordinatorPluginDependencies { sessionId: string; playerId: string; jobs: DurableJobQueue; world: WorldStateReader; states: CharacterInteractionStateStore; store: InteractionPlanStore & InteractionExecutionStore; commands: CommandGateway; eventTasks: { register(scheduler: EventTaskScheduler): () => void }; intervalMs?: number; onError?: (error: unknown) => void; }
class InteractionCoordinatorService extends Service implements InteractionCoordinatorController { public constructor(ctx: Context, private readonly controller: InteractionCoordinatorController) { super(ctx, "worldInteractionCoordinator"); } public drain(sessionId: string) { return this.controller.drain(sessionId); } }

/** Owns participant planning after a confirmed player utterance; Agent execution stays outside this first stage. */
export function createInteractionCoordinatorPlugin(dependencies: InteractionCoordinatorPluginDependencies): CordisGamePluginDefinition {
  const worker = new InteractionCoordinatorWorker(dependencies.jobs, dependencies.world, dependencies.states, dependencies.store);
  const executionWorker = new InteractionExecutionWorker(dependencies.jobs, dependencies.store, dependencies.commands);
  const scheduler = new InteractionCoordinatorScheduler(dependencies.jobs, dependencies.playerId);
  const controller: InteractionCoordinatorController = { async drain(sessionId) { return await worker.drain(sessionId) + Number(await executionWorker.processNext(sessionId)); } };
  const report = dependencies.onError ?? ((error: unknown) => console.error("interaction coordination failed", error));
  const intervalMs = dependencies.intervalMs ?? 5_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error("interaction_coordinator_interval_invalid");
  return { manifest: { id: "feature.interaction-coordinator", version: "1.0.0", configVersion: 1, requires: ["world.jobs", "world.eventTasks", "world.state", "world.sceneLifecycle", "world.commandGateway"], provides: [{ id: WORLD_INTERACTION_COORDINATOR_CAPABILITY, serviceKey: "worldInteractionCoordinator" }], ownsJobs: ["interaction.coordinate", "interaction.execute"] }, implementation: (ctx: Context) => {
    new InteractionCoordinatorService(ctx, controller);
    ctx.effect(() => { const unregister = dependencies.eventTasks.register(scheduler); const wake = () => { void controller.drain(dependencies.sessionId).catch(report); }; const unsubscribe = dependencies.commands.subscribe(() => wake()); wake(); const interval = setInterval(wake, intervalMs); interval.unref(); return () => { unregister(); unsubscribe(); clearInterval(interval); }; });
  } };
}
