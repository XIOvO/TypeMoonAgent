import { Service, type Context } from "@deepseek-ai/cordis";
import { SceneLifecycleScheduler, SceneLifecycleWorker, type SceneLifecycleStore } from "../../core/scene-lifecycle.js";
import type { DurableJobQueue, EventTaskScheduler } from "../../core/durable-jobs.js";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";

export const WORLD_SCENE_LIFECYCLE_CAPABILITY = "world.sceneLifecycle";
export interface SceneLifecycleController { drain(sessionId: string): Promise<number>; }
export interface SceneLifecyclePluginDependencies { sessionId: string; playerId: string; jobs: DurableJobQueue; store: SceneLifecycleStore; commands: CommandGateway; eventTasks: { register(scheduler: EventTaskScheduler): () => void }; intervalMs?: number; onError?: (error: unknown) => void; }

class SceneLifecycleControllerService extends Service implements SceneLifecycleController {
  public constructor(ctx: Context, private readonly controller: SceneLifecycleController) { super(ctx, "worldSceneLifecycle"); }
  public drain(sessionId: string) { return this.controller.drain(sessionId); }
}

/** Derives durable, player-facing scene semantics from committed Runtime facts. */
export function createSceneLifecyclePlugin(dependencies: SceneLifecyclePluginDependencies): CordisGamePluginDefinition {
  const worker = new SceneLifecycleWorker(dependencies.jobs, dependencies.store);
  const scheduler = new SceneLifecycleScheduler(dependencies.jobs, dependencies.playerId);
  const controller: SceneLifecycleController = { drain: (sessionId) => worker.drain(sessionId) };
  const report = dependencies.onError ?? ((error: unknown) => console.error("scene lifecycle failed", error));
  const intervalMs = dependencies.intervalMs ?? 5_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error("scene_lifecycle_interval_invalid");
  return { manifest: { id: "feature.scene-lifecycle", version: "1.0.0", configVersion: 1, requires: ["world.jobs", "world.eventTasks", "world.commandGateway"], provides: [{ id: WORLD_SCENE_LIFECYCLE_CAPABILITY, serviceKey: "worldSceneLifecycle" }], ownsJobs: ["scene.lifecycle"] }, implementation: (ctx: Context) => {
    new SceneLifecycleControllerService(ctx, controller);
    ctx.effect(() => {
      const unregister = dependencies.eventTasks.register(scheduler);
      const wake = () => { void controller.drain(dependencies.sessionId).catch(report); };
      const unsubscribe = dependencies.commands.subscribe(() => wake());
      wake(); const interval = setInterval(wake, intervalMs); interval.unref();
      return () => { unregister(); unsubscribe(); clearInterval(interval); };
    });
  } };
}
