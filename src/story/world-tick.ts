import { randomUUID } from "node:crypto";
import type { DurableJob, DurableJobQueue, EventTaskScheduler } from "../core/durable-jobs.js";
import type { GameEvent, GameMoment, GameState } from "../core/contracts.js";
import { exitGraphNavigation, type NavigationPlanner } from "../core/navigation.js";
import type { CharacterRuntimeState } from "../cif/types.js";

export interface WorldTickInput {
  sessionId: string;
  moment: GameMoment;
  sourceEventId: string;
}

/** A deterministic policy may nominate actors, but it never runs them or changes the world. */
export interface WorldTickPlanner {
  select(input: WorldTickInput & { world: Readonly<GameState> }): readonly { actorId: string; reason: string; targetLocationId?: string }[];
}

export const noWorldTickCandidates: WorldTickPlanner = { select: () => [] };

export interface WorldSimulationInput extends WorldTickInput {
  jobId: string;
  actorId: string;
  reason: string;
  targetLocationId?: string;
}

/** A later model-backed executor must submit all proposed changes through Runtime. */
export interface WorldSimulationExecutor {
  execute(input: WorldSimulationInput): Promise<void>;
}

/** Deliberate stage-one executor: safely consumes eligible work without autonomous actions. */
export const noWorldSimulationExecutor: WorldSimulationExecutor = { execute: async () => {} };

/** Read-only seam so candidate policy never owns or mutates CIF state. */
export interface CharacterRuntimeStateProvider {
  getRuntimeState(sessionId: string, characterId: string): CharacterRuntimeState | undefined;
}

export interface CharacterRuntimeStateStore extends CharacterRuntimeStateProvider {
  saveRuntimeState(state: CharacterRuntimeState): void;
}

/** The simulation only needs current durable world snapshots, not event writes. */
export interface WorldStateHistory {
  loadWorldState(sessionId: string): GameState | undefined;
}

/**
 * Conservative, deterministic admission policy for future NPC simulation.
 * It intentionally only considers NPCs already present with the player and
 * an explicit pending intention, plan, or goal.
 */
export class PresentFreeCharacterWorldTickPlanner implements WorldTickPlanner {
  public constructor(
    private readonly states: CharacterRuntimeStateProvider,
    private readonly playerId: string,
    private readonly maxCandidates = 2,
    private readonly cooldownTicks = 3,
    private readonly navigation: NavigationPlanner = exitGraphNavigation,
  ) {
    if (!playerId.trim()) throw new Error("world_tick_player_id_required");
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 8) throw new Error("world_tick_max_candidates_invalid");
    if (!Number.isSafeInteger(cooldownTicks) || cooldownTicks < 1 || cooldownTicks > 100) throw new Error("world_tick_cooldown_invalid");
  }

  public select(input: WorldTickInput & { world: Readonly<GameState> }): readonly { actorId: string; reason: string }[] {
    if (input.world.battle?.status === "active") return [];
    const player = input.world.characters[this.playerId];
    if (!player?.locationId) return [];
    const candidates: Array<{ actorId: string; reason: string; targetLocationId?: string }> = Object.values(input.world.characters)
      .filter((character) => character.id !== this.playerId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .flatMap((character): Array<{ actorId: string; reason: string; targetLocationId?: string }> => {
        const state = this.states.getRuntimeState(input.sessionId, character.id);
        if (!state || state.availability !== "free" || !pendingReason(state)) return [];
        if (character.locationId === player.locationId && readyForProactiveInteraction(state, input.moment.tick, this.cooldownTicks)) return [{ actorId: character.id, reason: pendingReason(state)! }];
        if (character.locationId !== player.locationId && state.approachPlayer === "when_safe" && state.knownPlayerLocationId === player.locationId && this.navigation.findRoute(input.world, character.locationId, player.locationId).kind === "reachable") {
          return [{ actorId: character.id, reason: "approach_player", targetLocationId: player.locationId }];
        }
        return [];
      });
    return candidates.sort((left, right) => left.reason === "approach_player" ? 1 : right.reason === "approach_player" ? -1 : left.actorId.localeCompare(right.actorId)).slice(0, this.maxCandidates);
  }
}

/** Adds one durable task for each Runtime-confirmed tick. */
export class WorldTickScheduler implements EventTaskScheduler {
  public constructor(private readonly jobs: DurableJobQueue) {}

  public schedule(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type !== "time_waited" || !validMoment(event.moment)) continue;
      const moment = event.moment;
      this.jobs.enqueue({
        id: randomUUID(), sessionId: event.sessionId, kind: "world.tick", dedupeKey: `${moment.timelineId}:${moment.tick}`,
        payload: { timelineId: moment.timelineId, tick: moment.tick, sourceEventId: event.id }, status: "pending", attempts: 0,
        maxAttempts: 3, availableAt: event.createdAt, createdAt: event.createdAt,
      });
    }
  }
}

/**
 * Converts a current tick into durable, per-actor simulation candidates. A
 * stale tick is acknowledged without backfilling NPC behavior.
 */
export class WorldTickWorker {
  public constructor(
    private readonly jobs: DurableJobQueue,
    private readonly history: WorldStateHistory,
    private readonly planner: WorldTickPlanner = noWorldTickCandidates,
  ) {}

  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "world-tick-worker";
    const job = this.jobs.claim({
      sessionId, workerId, kind: "world.tick", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString(),
    });
    if (!job) return false;
    try {
      const input = tickInput(job);
      const world = this.history.loadWorldState(sessionId);
      if (!world || !sameMoment(world.moment, input.moment)) {
        this.jobs.complete(job.id, workerId, now.toISOString());
        return true;
      }
      const candidates = uniqueCandidates(this.planner.select({ ...input, world }), world);
      this.jobs.transaction(() => {
        for (const candidate of candidates) this.jobs.enqueue({
          id: randomUUID(), sessionId, kind: "world.simulation", dedupeKey: `${input.moment.timelineId}:${input.moment.tick}:${candidate.actorId}`,
          payload: { timelineId: input.moment.timelineId, tick: input.moment.tick, sourceEventId: input.sourceEventId, actorId: candidate.actorId, reason: candidate.reason, ...(candidate.targetLocationId ? { targetLocationId: candidate.targetLocationId } : {}) },
          status: "pending", attempts: 0, maxAttempts: 3, availableAt: now.toISOString(), createdAt: now.toISOString(),
        });
        this.jobs.complete(job.id, workerId, now.toISOString());
      });
      return true;
    } catch (error) {
      this.jobs.retry(job.id, workerId, error instanceof Error ? error.message : "world_tick_failed", new Date(now.getTime() + 1_000).toISOString());
      return true;
    }
  }

  public async drain(sessionId: string): Promise<number> {
    let processed = 0;
    while (await this.processNext(sessionId)) processed += 1;
    return processed;
  }
}

/**
 * Consumes one simulation candidate only while the source scene is still current.
 * Invalidated work is completed, while executor failures remain retryable.
 */
export class WorldSimulationWorker {
  public constructor(
    private readonly jobs: DurableJobQueue,
    private readonly history: WorldStateHistory,
    private readonly states: CharacterRuntimeStateProvider,
    private readonly playerId: string,
    private readonly executor: WorldSimulationExecutor = noWorldSimulationExecutor,
    private readonly navigation: NavigationPlanner = exitGraphNavigation,
  ) {
    if (!playerId.trim()) throw new Error("world_simulation_player_id_required");
  }

  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "world-simulation-worker";
    const job = this.jobs.claim({
      sessionId, workerId, kind: "world.simulation", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString(),
    });
    if (!job) return false;
    try {
      const input = simulationInput(job);
      const world = this.history.loadWorldState(sessionId);
      if (!world || !sameMoment(world.moment, input.moment) || !isEligibleSimulation(this.states, this.navigation, world, this.playerId, input)) {
        this.jobs.complete(job.id, workerId, now.toISOString());
        return true;
      }
      await this.executor.execute(input);
      this.jobs.complete(job.id, workerId, now.toISOString());
      return true;
    } catch (error) {
      this.jobs.retry(job.id, workerId, error instanceof Error ? error.message : "world_simulation_failed", new Date(now.getTime() + 1_000).toISOString());
      return true;
    }
  }

  public async drain(sessionId: string): Promise<number> {
    let processed = 0;
    while (await this.processNext(sessionId)) processed += 1;
    return processed;
  }
}

function tickInput(job: DurableJob): WorldTickInput {
  const { timelineId, tick, sourceEventId } = job.payload;
  if (typeof timelineId !== "string" || !timelineId || typeof tick !== "number" || !Number.isSafeInteger(tick) || tick < 0 || typeof sourceEventId !== "string" || !sourceEventId) {
    throw new Error("invalid_world_tick_job");
  }
  return { sessionId: job.sessionId, moment: { timelineId, tick }, sourceEventId };
}

function simulationInput(job: DurableJob): WorldSimulationInput {
  const tick = tickInput(job);
  const { actorId, reason, targetLocationId } = job.payload;
  if (typeof actorId !== "string" || !actorId || typeof reason !== "string" || !reason) throw new Error("invalid_world_simulation_job");
  if (targetLocationId !== undefined && (typeof targetLocationId !== "string" || !targetLocationId)) throw new Error("invalid_world_simulation_job");
  return { ...tick, jobId: job.id, actorId, reason, ...(typeof targetLocationId === "string" ? { targetLocationId } : {}) };
}

function validMoment(moment: GameMoment | undefined): moment is GameMoment {
  return Boolean(moment && moment.timelineId && Number.isSafeInteger(moment.tick) && moment.tick >= 0);
}

function sameMoment(left: GameMoment | undefined, right: GameMoment): boolean {
  return left?.timelineId === right.timelineId && left.tick === right.tick;
}

function uniqueCandidates(candidates: readonly { actorId: string; reason: string; targetLocationId?: string }[], world: GameState): Array<{ actorId: string; reason: string; targetLocationId?: string }> {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.actorId || !candidate.reason || !world.characters[candidate.actorId] || seen.has(candidate.actorId)) return false;
    seen.add(candidate.actorId);
    return true;
  });
}

function pendingReason(state: CharacterRuntimeState): "current_plan" | "current_intention" | "active_goal" | undefined {
  if (state.currentPlan?.trim()) return "current_plan";
  if (state.currentIntention?.trim()) return "current_intention";
  return state.activeGoals.some((goal) => goal.trim()) ? "active_goal" : undefined;
}

function isEligibleSimulation(states: CharacterRuntimeStateProvider, navigation: NavigationPlanner, world: GameState, playerId: string, input: WorldSimulationInput): boolean {
  if (world.battle?.status === "active") return false;
  const player = world.characters[playerId];
  const actor = world.characters[input.actorId];
  if (!player || !actor || input.actorId === playerId) return false;
  const state = states.getRuntimeState(world.sessionId, input.actorId);
  if (!state || state.availability !== "free" || !pendingReason(state)) return false;
  if (input.reason === "approach_player") return actor.locationId !== player.locationId && state.approachPlayer === "when_safe" && state.knownPlayerLocationId === player.locationId && input.targetLocationId === player.locationId && navigation.findRoute(world, actor.locationId, player.locationId).kind === "reachable";
  return player.locationId === actor.locationId && readyForProactiveInteraction(state, world.moment?.tick ?? -1, 3);
}

function readyForProactiveInteraction(state: CharacterRuntimeState, tick: number, cooldownTicks: number): boolean {
  return state.lastProactiveInteractionTick === undefined || tick - state.lastProactiveInteractionTick >= cooldownTicks;
}
