import { randomUUID } from "node:crypto";
import { Service, type Context } from "@deepseek-ai/cordis";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { DurableJobQueue, EventTaskScheduler } from "../../core/durable-jobs.js";
import { InteractionCoordinatorScheduler, InteractionCoordinatorWorker, SameSceneInteractionTargetResolver, type CharacterInteractionStateStore, type InteractionPlanStore } from "../../core/interaction-coordinator.js";
import type { InteractionCommandHandler, InteractionDialogueCommand } from "../../core/interaction-command-handler.js";
import { InteractionExecutionWorker, type InteractionExecutionOutbox, type InteractionExecutionStore } from "../../core/interaction-execution.js";
import type { WorldStateReader } from "../../core/world-state.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";

export const WORLD_INTERACTION_COORDINATOR_CAPABILITY = "world.interactionCoordinator";
export const INTERACTION_PLAN_CAPABILITY = "interaction.plan";
export const INTERACTION_EXECUTE_CAPABILITY = "interaction.execute";
export const INTERACTION_COMMAND_HANDLER_CAPABILITY = "interaction.commandHandler";

export interface InteractionCoordinatorController { drain(sessionId: string): Promise<number>; }
/** Stable facade for durable, explainable interaction participant planning. */
export interface InteractionPlanController { drain(sessionId: string): Promise<number>; }
/** Stable facade for delivering one recoverable interaction execution at a time. */
export interface InteractionExecuteController { processNext(sessionId: string): Promise<boolean>; }
export interface InteractionCoordinatorPluginDependencies { sessionId: string; playerId: string; jobs: DurableJobQueue; world: WorldStateReader; states: CharacterInteractionStateStore; store: InteractionPlanStore & InteractionExecutionStore; handler: InteractionCommandHandler; commands: CommandGateway; eventTasks: { register(scheduler: EventTaskScheduler): () => void }; intervalMs?: number; onError?: (error: unknown) => void; }
class InteractionCoordinatorService extends Service implements InteractionCoordinatorController { public constructor(ctx: Context, private readonly controller: InteractionCoordinatorController) { super(ctx, "worldInteractionCoordinator"); } public drain(sessionId: string) { return this.controller.drain(sessionId); } }
class InteractionPlanService extends Service implements InteractionPlanController { public constructor(ctx: Context, private readonly controller: InteractionPlanController) { super(ctx, "interactionPlan"); } public drain(sessionId: string) { return this.controller.drain(sessionId); } }
class InteractionExecuteService extends Service implements InteractionExecuteController { public constructor(ctx: Context, private readonly controller: InteractionExecuteController) { super(ctx, "interactionExecute"); } public processNext(sessionId: string) { return this.controller.processNext(sessionId); } }
class InteractionCommandHandlerService extends Service implements InteractionCommandHandler { public constructor(ctx: Context, private readonly handler: InteractionCommandHandler) { super(ctx, "interactionCommandHandler"); } public resolveTarget(input: Parameters<InteractionCommandHandler["resolveTarget"]>[0]) { return this.handler.resolveTarget(input); } public createExecutionCommitEffect(input: InteractionDialogueCommand) { return this.handler.createExecutionCommitEffect?.(input) ?? (() => undefined); } }

/** Feature-owned adapter from the durable interaction workflow to Runtime's capability contract. */
export class DurableInteractionCommandHandler implements InteractionCommandHandler {
  private readonly targets: SameSceneInteractionTargetResolver;
  public constructor(states: CharacterInteractionStateStore, private readonly outbox: InteractionExecutionOutbox) {
    this.targets = new SameSceneInteractionTargetResolver(states);
  }
  public resolveTarget(input: Parameters<InteractionCommandHandler["resolveTarget"]>[0]): string | undefined {
    return this.targets.resolve(input);
  }
  public createExecutionCommitEffect(input: InteractionDialogueCommand): () => void {
    const execution = { id: randomUUID(), sessionId: input.action.sessionId, playerActionId: input.action.id, playerId: input.action.actorId,
      sceneId: input.sceneId, leadCharacterId: input.targetId, action: input.action, status: "planned" as const, attempt: 0, maxAttempts: 5,
      createdAt: input.createdAt, updatedAt: input.createdAt };
    return () => this.outbox.enqueueInteractionExecutionInTransaction(execution);
  }
}

/** Owns durable interaction planning and execution; the legacy coordinator facade remains compatible. */
export function createInteractionCoordinatorPlugin(dependencies: InteractionCoordinatorPluginDependencies): CordisGamePluginDefinition {
  const worker = new InteractionCoordinatorWorker(dependencies.jobs, dependencies.world, dependencies.states, dependencies.store);
  const executionWorker = new InteractionExecutionWorker(dependencies.jobs, dependencies.store, dependencies.commands);
  const scheduler = new InteractionCoordinatorScheduler(dependencies.jobs, dependencies.playerId);
  const plan: InteractionPlanController = { drain: (sessionId) => worker.drain(sessionId) };
  const execute: InteractionExecuteController = { processNext: (sessionId) => executionWorker.processNext(sessionId) };
  const controller: InteractionCoordinatorController = { async drain(sessionId) { return await plan.drain(sessionId) + Number(await execute.processNext(sessionId)); } };
  const report = dependencies.onError ?? ((error: unknown) => console.error("interaction coordination failed", error));
  const intervalMs = dependencies.intervalMs ?? 5_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error("interaction_coordinator_interval_invalid");
  return { manifest: { id: "feature.interaction-coordinator", version: "1.2.0", configVersion: 1, requires: ["world.jobs", "world.eventTasks", "world.state", "world.sceneLifecycle", "world.commandGateway"], provides: [{ id: WORLD_INTERACTION_COORDINATOR_CAPABILITY, serviceKey: "worldInteractionCoordinator" }, { id: INTERACTION_PLAN_CAPABILITY, serviceKey: "interactionPlan" }, { id: INTERACTION_EXECUTE_CAPABILITY, serviceKey: "interactionExecute" }, { id: INTERACTION_COMMAND_HANDLER_CAPABILITY, serviceKey: "interactionCommandHandler" }], ownsJobs: ["interaction.coordinate", "interaction.execute"] }, implementation: (ctx: Context) => {
    new InteractionCoordinatorService(ctx, controller);
    new InteractionPlanService(ctx, plan);
    new InteractionExecuteService(ctx, execute);
    new InteractionCommandHandlerService(ctx, dependencies.handler);
    ctx.effect(() => { const unregister = dependencies.eventTasks.register(scheduler); const wake = () => { void controller.drain(dependencies.sessionId).catch(report); }; const unsubscribe = dependencies.commands.subscribe(() => wake()); wake(); const interval = setInterval(wake, intervalMs); interval.unref(); return () => { unregister(); unsubscribe(); clearInterval(interval); }; });
  } };
}
