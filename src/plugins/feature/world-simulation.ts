import { Service, type Context } from "@deepseek-ai/cordis";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { NavigationPlanner } from "../../core/navigation.js";
import type { DurableJobQueue, EventTaskScheduler } from "../../core/durable-jobs.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import { RuntimeWorldSimulationExecutor } from "../../story/runtime-world-simulation-executor.js";
import {
  PresentFreeCharacterWorldTickPlanner,
  WorldSimulationWorker,
  WorldTickScheduler,
  WorldTickWorker,
  type CharacterRuntimeStateStore,
  type WorldStateHistory,
} from "../../story/world-tick.js";

export const WORLD_SIMULATION_CAPABILITY = "world.simulation";

export interface WorldSimulationController {
  drain(sessionId: string): Promise<number>;
}

export interface WorldSimulationPluginDependencies {
  sessionId: string;
  playerId: string;
  jobs: DurableJobQueue;
  history: WorldStateHistory;
  states: CharacterRuntimeStateStore;
  commands: CommandGateway;
  navigation: NavigationPlanner;
  eventTasks: { register(scheduler: EventTaskScheduler): () => void };
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

class WorldSimulationControllerService extends Service implements WorldSimulationController {
  public constructor(ctx: Context, private readonly controller: WorldSimulationController) { super(ctx, "worldSimulation"); }
  public drain(sessionId: string) { return this.controller.drain(sessionId); }
}

/**
 * Owns ordinary NPC initiative: confirmed time ticks become durable candidates,
 * whose effects can only be requested through the command gateway.
 */
export function createWorldSimulationPlugin(dependencies: WorldSimulationPluginDependencies): CordisGamePluginDefinition {
  const planner = new PresentFreeCharacterWorldTickPlanner(dependencies.states, dependencies.playerId, 2, 3, dependencies.navigation);
  const tickScheduler = new WorldTickScheduler(dependencies.jobs);
  const tickWorker = new WorldTickWorker(dependencies.jobs, dependencies.history, planner);
  const simulationWorker = new WorldSimulationWorker(
    dependencies.jobs, dependencies.history, dependencies.states, dependencies.playerId,
    new RuntimeWorldSimulationExecutor(dependencies.commands, dependencies.states, dependencies.playerId), dependencies.navigation,
  );
  const controller: WorldSimulationController = {
    async drain(sessionId: string): Promise<number> {
      const ticks = await tickWorker.drain(sessionId);
      return ticks + await simulationWorker.drain(sessionId);
    },
  };
  const report = dependencies.onError ?? ((error: unknown) => console.error("world simulation failed", error));
  const intervalMs = dependencies.intervalMs ?? 30_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error("world_simulation_interval_invalid");

  return {
    manifest: {
      id: "feature.world-simulation",
      version: "1.0.0",
      configVersion: 1,
      requires: ["world.jobs", "world.eventTasks", "world.eventHistory", "world.state", "world.navigation", "world.commandGateway"],
      provides: [{ id: WORLD_SIMULATION_CAPABILITY, serviceKey: "worldSimulation" }],
      ownsJobs: ["world.tick", "world.simulation"],
    },
    implementation: (ctx: Context) => {
      new WorldSimulationControllerService(ctx, controller);
      ctx.effect(() => {
        const unregister = dependencies.eventTasks.register(tickScheduler);
        const wake = () => { void controller.drain(dependencies.sessionId).catch(report); };
        const unsubscribe = dependencies.commands.subscribe((event) => { if (event.type === "time_waited") wake(); });
        wake();
        const interval = setInterval(wake, intervalMs);
        interval.unref();
        return () => { unregister(); unsubscribe(); clearInterval(interval); };
      });
    },
  };
}
