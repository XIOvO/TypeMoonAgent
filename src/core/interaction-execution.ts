export type InteractionExecutionStatus = "planned" | "executing" | "retry_wait" | "completed" | "skipped" | "failed" | "exhausted";
export interface InteractionExecution {
  id: string; sessionId: string; playerActionId: string; playerId: string; sceneId: string; leadCharacterId?: string;
  action: import("./contracts.js").PlayerAction;
  status: InteractionExecutionStatus; attempt: number; maxAttempts: number; reason?: string; responseEventId?: string; createdAt: string; updatedAt: string;
}

export interface InteractionExecutionStore {
  getInteractionExecutionById(id: string): InteractionExecution | undefined;
  getInteractionExecution(sessionId: string, playerActionId: string): InteractionExecution | undefined;
  saveInteractionExecution(execution: InteractionExecution): void;
  transitionInteractionExecution(id: string, from: readonly InteractionExecutionStatus[], next: InteractionExecutionStatus, updatedAt: string, reason?: string, responseEventId?: string): boolean;
}

/** Narrow port used by the coordinator to create a recoverable outbox entry. */
export interface InteractionExecutionOutbox extends InteractionExecutionStore {
  enqueueInteractionExecution(execution: InteractionExecution): void;
  /** Called inside the source player turn's transaction to keep the outbox atomic. */
  enqueueInteractionExecutionInTransaction(execution: InteractionExecution): void;
}

export interface InteractionExecutionGateway { execute(command: import("../protocol/command.js").CommandEnvelope<InteractionExecution>): Promise<import("./contracts.js").ActionResult>; }
export class InteractionExecutionWorker {
  public constructor(private readonly jobs: import("./durable-jobs.js").DurableJobQueue, private readonly store: InteractionExecutionStore, private readonly gateway: InteractionExecutionGateway) {}
  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "interaction-execution-worker";
    const job = this.jobs.claim({ sessionId, workerId, kind: "interaction.execute", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString() });
    if (!job) return false;
    try {
      const id = typeof job.payload.executionId === "string" ? job.payload.executionId : undefined;
      const execution = id && this.store.getInteractionExecutionById(id);
      if (!execution || !execution.leadCharacterId || !this.store.transitionInteractionExecution(execution.id, ["planned", "retry_wait"], "executing", now.toISOString())) { this.jobs.complete(job.id, workerId, now.toISOString()); return true; }
      const result = await this.gateway.execute({
        id: execution.id, sessionId: execution.sessionId, type: "interaction.execute", payload: execution,
        causation: { playerActionId: execution.playerActionId }, correlationId: `interaction:${execution.id}`,
      });
      const response = result.events.find((event) => event.type === "character_spoke" && event.payload.characterId === execution.leadCharacterId);
      this.jobs.transaction(() => { this.store.transitionInteractionExecution(execution.id, ["executing"], response ? "completed" : "skipped", now.toISOString(), response ? undefined : "no_confirmed_response", response?.id); this.jobs.complete(job.id, workerId, now.toISOString()); });
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "interaction_execution_failed";
      this.jobs.transaction(() => {
        this.store.transitionInteractionExecution(executionId(job), ["executing"], job.attempts >= job.maxAttempts ? "exhausted" : "retry_wait", now.toISOString(), reason);
        this.jobs.retry(job.id, workerId, reason, new Date(now.getTime() + 1_000).toISOString());
      });
      return true;
    }
  }
}

function executionId(job: import("./durable-jobs.js").DurableJob): string {
  return typeof job.payload.executionId === "string" ? job.payload.executionId : "";
}

export function canTransition(from: InteractionExecutionStatus, next: InteractionExecutionStatus): boolean {
  const transitions: Record<InteractionExecutionStatus, InteractionExecutionStatus[]> = { planned: ["executing", "skipped"], executing: ["completed", "retry_wait", "failed", "skipped"], retry_wait: ["executing", "exhausted"], completed: [], skipped: [], failed: [], exhausted: [] };
  return transitions[from].includes(next);
}
