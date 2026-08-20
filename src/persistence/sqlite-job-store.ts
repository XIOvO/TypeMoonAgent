import type { DurableJob } from "../core/durable-jobs.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { JobClaim, JobStore } from "./contracts/index.js";

/** SQLite adapter for the stable JobStore port; transaction ownership remains with callers. */
export class SqliteJobStore implements JobStore<DurableJob> {
  public constructor(private readonly repository: SqliteCifRepository) {}

  public async enqueue(job: DurableJob): Promise<void> { this.repository.enqueueDurableJob(job); }
  public async claim(claim: JobClaim): Promise<DurableJob | undefined> { return this.repository.claimDurableJob(claim); }
  public async complete(id: string, workerId: string, completedAt: string): Promise<void> { this.repository.completeDurableJob(id, workerId, completedAt); }
  public async retry(id: string, workerId: string, error: string, availableAt: string): Promise<void> { this.repository.retryDurableJob(id, workerId, error, availableAt); }
  public async defer(id: string, workerId: string, availableAt: string): Promise<void> { this.repository.deferDurableJob(id, workerId, availableAt); }
}
