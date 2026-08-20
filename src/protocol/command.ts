/** Normalized internal request; execution remains the authority's job. */
export interface CommandEnvelope<T = unknown> {
  id: string;
  sessionId: string;
  type: string;
  actorId?: string;
  payload: T;
  causation: CommandCausation;
  correlationId: string;
}

export interface CommandCausation {
  playerActionId?: string;
  agentActionId?: string;
  sourceEventId?: string;
}

export interface CommandResult {
  accepted: boolean;
  events?: ProposedEvent[];
  mutations?: StateMutationProposal[];
  jobs?: ProposedJob[];
  rejection?: CommandRejection;
}

/** Candidate only: the commit authority assigns final event sequencing. */
export interface ProposedEvent<T = unknown> {
  type: string;
  payload: T;
  recipients?: string[];
}

/** Candidate only: the commit authority validates and applies mutations. */
export interface StateMutationProposal<T = unknown> {
  type: string;
  payload: T;
}

/** Candidate only: the durable job service owns scheduling and claiming. */
export interface ProposedJob<T = unknown> {
  type: string;
  payload: T;
  runAt?: string;
}

export interface CommandRejection {
  code: string;
  details?: Record<string, unknown>;
}
