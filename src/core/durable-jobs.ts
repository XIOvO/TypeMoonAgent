import type { GameEvent } from "./contracts.js";

/** Adds durable work while the producing turn transaction is still open. */
export interface EventTaskScheduler {
  schedule(events: readonly GameEvent[]): void;
}

/** Combines independent producers without giving either one ownership of a turn. */
export class CompositeEventTaskScheduler implements EventTaskScheduler {
  public constructor(private readonly schedulers: readonly EventTaskScheduler[]) {}
  public schedule(events: readonly GameEvent[]): void {
    for (const scheduler of this.schedulers) scheduler.schedule(events);
  }
}

/**
 * A durable work item. It is deliberately independent from memory: CIF
 * consolidation, L2 proposals, indexing, notifications and future world ticks
 * all use the same delivery contract.
 */
export interface DurableJob {
  id: string;
  sessionId: string;
  kind: string;
  /** Stable producer-side key. The same logical work may only be enqueued once. */
  dedupeKey: string;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "dead";
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  leasedAt?: string;
  leaseOwner?: string;
  completedAt?: string;
  error?: string;
  createdAt: string;
}

export interface DurableJobClaim {
  sessionId: string;
  workerId: string;
  kind?: string;
  now: string;
  leaseExpiresBefore: string;
}

/** Durable queue port shared by system implementations and feature workers. */
export interface DurableJobQueue {
  transaction<T>(operation: () => T): T;
  enqueue(job: DurableJob): void;
  claim(claim: DurableJobClaim): DurableJob | undefined;
  complete(id: string, workerId: string, completedAt: string): void;
  retry(id: string, workerId: string, error: string, availableAt: string): void;
  defer(id: string, workerId: string, availableAt: string): void;
}
