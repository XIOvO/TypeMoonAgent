import { Service, type Context } from "@deepseek-ai/cordis";
import { SqliteCifRepository } from "../../cif/sqlite-repository.js";
import type { DurableJob, DurableJobClaim, DurableJobQueue, EventTaskScheduler } from "../../core/durable-jobs.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";

export const WORLD_JOBS_CAPABILITY = "world.jobs";
export const WORLD_EVENT_TASKS_CAPABILITY = "world.eventTasks";

/** The only durable-job API future game plugins may consume. */
export type { DurableJobQueue } from "../../core/durable-jobs.js";

/**
 * Transaction-local event fan-out. Producers are registered by feature
 * plugins; TurnCommitter invokes this only while its outer transaction is open.
 */
export class EventTaskRegistry implements EventTaskScheduler {
  private readonly schedulers = new Set<EventTaskScheduler>();
  private closed = false;

  public register(scheduler: EventTaskScheduler): () => void {
    if (this.closed) throw new Error("Event task registry has been disposed.");
    this.schedulers.add(scheduler);
    return () => this.schedulers.delete(scheduler);
  }

  public schedule(events: Parameters<EventTaskScheduler["schedule"]>[0]): void {
    if (this.closed) return;
    for (const scheduler of this.schedulers) scheduler.schedule(events);
  }

  public close(): void {
    this.closed = true;
    this.schedulers.clear();
  }
}

class EventTaskRegistryService extends Service implements EventTaskScheduler {
  public constructor(ctx: Context, private readonly registry: EventTaskRegistry) { super(ctx, "worldEventTasks"); }
  public register(scheduler: EventTaskScheduler): () => void { return this.registry.register(scheduler); }
  public schedule(events: Parameters<EventTaskScheduler["schedule"]>[0]): void { this.registry.schedule(events); }
}

export class SqliteDurableJobQueue implements DurableJobQueue {
  public constructor(private readonly repository: SqliteCifRepository) {}
  public transaction<T>(operation: () => T): T { return this.repository.transaction(operation); }
  public enqueue(job: DurableJob): void { this.repository.enqueueDurableJob(job); }
  public claim(claim: DurableJobClaim): DurableJob | undefined { return this.repository.claimDurableJob(claim); }
  public complete(id: string, workerId: string, completedAt: string): void { this.repository.completeDurableJob(id, workerId, completedAt); }
  public retry(id: string, workerId: string, error: string, availableAt: string): void { this.repository.retryDurableJob(id, workerId, error, availableAt); }
  public defer(id: string, workerId: string, availableAt: string): void { this.repository.deferDurableJob(id, workerId, availableAt); }
}

class SqliteDurableJobQueueService extends Service implements DurableJobQueue {
  public constructor(ctx: Context, private readonly queue: DurableJobQueue) { super(ctx, "worldJobs"); }
  public transaction<T>(operation: () => T): T { return this.queue.transaction(operation); }
  public enqueue(job: DurableJob): void { this.queue.enqueue(job); }
  public claim(claim: DurableJobClaim): DurableJob | undefined { return this.queue.claim(claim); }
  public complete(id: string, workerId: string, completedAt: string): void { this.queue.complete(id, workerId, completedAt); }
  public retry(id: string, workerId: string, error: string, availableAt: string): void { this.queue.retry(id, workerId, error, availableAt); }
  public defer(id: string, workerId: string, availableAt: string): void { this.queue.defer(id, workerId, availableAt); }
}

/**
 * First system plugin. It owns queue capability boundaries but deliberately
 * does not own any task kind: feature plugins retain that responsibility.
 */
export function createSqliteDurableJobsPlugin(repository: SqliteCifRepository, registry = new EventTaskRegistry(), queue = new SqliteDurableJobQueue(repository)): CordisGamePluginDefinition {
  return {
    manifest: {
      id: "system.durable-jobs",
      version: "1.0.0",
      configVersion: 1,
      provides: [
        { id: WORLD_JOBS_CAPABILITY, serviceKey: "worldJobs" },
        { id: WORLD_EVENT_TASKS_CAPABILITY, serviceKey: "worldEventTasks" },
      ],
    },
    implementation: (ctx: Context) => {
      new SqliteDurableJobQueueService(ctx, queue);
      new EventTaskRegistryService(ctx, registry);
      ctx.effect(() => () => registry.close());
    },
  };
}
