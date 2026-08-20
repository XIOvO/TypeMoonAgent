import type { EventId, EventSequence, JobId, SessionId, StateRevision } from "../../protocol/ids.js";

/** Query constraints shared by append-only event-store implementations. */
export interface EventQuery {
  sessionId: SessionId;
  afterSequence?: EventSequence;
  beforeSequence?: EventSequence;
  types?: readonly string[];
  limit?: number;
}

/**
 * An event persistence port. `TEvent` remains generic until E01-07 publishes
 * the stable GameEvent envelope, so this contract never depends on core types.
 */
export interface EventStore<TEvent = unknown> {
  append(sessionId: SessionId, events: readonly TEvent[]): Promise<void>;
  list(query: EventQuery): Promise<TEvent[]>;
  getByIds(sessionId: SessionId, eventIds: readonly EventId[]): Promise<TEvent[]>;
}

export interface StateSnapshot<TState = unknown> {
  sessionId: SessionId;
  revision: StateRevision;
  lastEventSequence: EventSequence;
  schemaVersion: number;
  state: TState;
  createdAt: string;
}

export interface SnapshotStore<TState = unknown> {
  load(sessionId: SessionId): Promise<StateSnapshot<TState> | undefined>;
  save(snapshot: StateSnapshot<TState>): Promise<void>;
}

export interface JobClaim {
  sessionId: SessionId;
  workerId: string;
  kind?: string;
  now: string;
  leaseExpiresBefore: string;
}

export interface JobStore<TJob = unknown> {
  enqueue(job: TJob): Promise<void>;
  claim(claim: JobClaim): Promise<TJob | undefined>;
  complete(jobId: JobId, workerId: string, completedAt: string): Promise<void>;
  retry(jobId: JobId, workerId: string, error: string, availableAt: string): Promise<void>;
  defer(jobId: JobId, workerId: string, availableAt: string): Promise<void>;
}

export interface MigrationRecord {
  id: string;
  checksum: string;
  appliedAt: string;
}

export interface MigrationStore {
  listApplied(): Promise<MigrationRecord[]>;
  recordApplied(migration: MigrationRecord): Promise<void>;
}
