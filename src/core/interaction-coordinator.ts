import { randomUUID } from "node:crypto";
import type { GameEvent, GameState, PlayerAction } from "./contracts.js";
import type { DurableJob, DurableJobQueue, EventTaskScheduler } from "./durable-jobs.js";
import type { WorldStateReader } from "./world-state.js";

export type InteractionPlanStatus = "planned" | "completed" | "skipped" | "failed";
export type InteractionParticipantRole = "lead" | "support_candidate" | "excluded";
export interface InteractionParticipant { characterId: string; role: InteractionParticipantRole; reasons: string[]; }
export interface InteractionPlan { id: string; sessionId: string; playerId: string; sceneId: string; sourceEventId: string; sourceActionId: string; status: InteractionPlanStatus; responseEventId?: string; leadCharacterId?: string; participants: InteractionParticipant[]; createdAt: string; updatedAt: string; }
export interface InteractionPlanStore { getInteractionPlanBySourceAction(sessionId: string, sourceActionId: string): InteractionPlan | undefined; saveInteractionPlan(plan: InteractionPlan): void; }
export interface CharacterInteractionRuntimeState { attention: string[]; activeGoals: string[]; availability?: "free" | "busy" | "blocked"; }
export interface CharacterInteractionStateStore { getRuntimeState(sessionId: string, characterId: string): CharacterInteractionRuntimeState | undefined; }
/** Runtime-facing port: resolves a dialogue recipient without exposing CIF or plugin internals. */
export interface InteractionTargetResolver { resolve(input: { state: Readonly<GameState>; action: PlayerAction; requestedTargetId?: string }): string | undefined; }

export class SameSceneInteractionTargetResolver implements InteractionTargetResolver {
  public constructor(private readonly states: CharacterInteractionStateStore) {}
  public resolve(input: { state: Readonly<GameState>; action: PlayerAction; requestedTargetId?: string }): string | undefined {
    if (input.requestedTargetId) return input.requestedTargetId;
    const player = input.state.characters[input.action.actorId];
    if (!player) return undefined;
    return Object.values(input.state.characters).filter((character) => character.id !== player.id && character.locationId === player.locationId)
      .filter((character) => { const runtime = this.states.getRuntimeState(input.action.sessionId, character.id); return !runtime?.availability || runtime.availability === "free"; })
      .sort((left, right) => score(this.states.getRuntimeState(input.action.sessionId, right.id), player.id) - score(this.states.getRuntimeState(input.action.sessionId, left.id), player.id) || left.id.localeCompare(right.id))[0]?.id;
  }
}

/** Adds one durable planning task for a confirmed player utterance, not for AI replies. */
export class InteractionCoordinatorScheduler implements EventTaskScheduler {
  public constructor(private readonly jobs: DurableJobQueue, private readonly playerId: string) {}
  public schedule(events: readonly GameEvent[]): void {
    for (const event of events) {
      const actionId = event.causation.playerActionId;
      if (event.type !== "player_spoke" || event.payload.characterId !== this.playerId || !actionId) continue;
      const response = events.find((item) => item.type === "character_spoke" && item.causation.playerActionId === actionId && item.payload.characterId === event.payload.targetId);
      this.jobs.enqueue({ id: randomUUID(), sessionId: event.sessionId, kind: "interaction.coordinate", dedupeKey: actionId, payload: { event, playerId: this.playerId, responseEventId: response?.id }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: event.createdAt, createdAt: event.createdAt });
    }
  }
}

/** Produces an explainable, durable plan. It neither calls an Agent nor changes GameState. */
export class InteractionCoordinatorWorker {
  public constructor(private readonly jobs: DurableJobQueue, private readonly world: WorldStateReader, private readonly states: CharacterInteractionStateStore, private readonly store: InteractionPlanStore) {}
  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "interaction-coordinator-worker";
    const job = this.jobs.claim({ sessionId, workerId, kind: "interaction.coordinate", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString() });
    if (!job) return false;
    try {
      const { event, playerId, responseEventId } = payload(job);
      const actionId = event.causation.playerActionId!;
      this.jobs.transaction(() => {
        if (!this.store.getInteractionPlanBySourceAction(event.sessionId, actionId)) this.store.saveInteractionPlan({ ...this.plan(event, playerId), ...(responseEventId ? { status: "completed", responseEventId } : {}) });
        this.jobs.complete(job.id, workerId, now.toISOString());
      });
      return true;
    } catch (error) { this.jobs.retry(job.id, workerId, error instanceof Error ? error.message : "interaction_coordinate_failed", new Date(now.getTime() + 1_000).toISOString()); return true; }
  }
  public async drain(sessionId: string): Promise<number> { let count = 0; while (await this.processNext(sessionId)) count += 1; return count; }
  private plan(event: GameEvent, playerId: string): InteractionPlan {
    const actionId = event.causation.playerActionId!;
    const sceneId = text(event.payload.locationId);
    if (!sceneId) throw new Error("interaction_location_missing");
    const targetId = text(event.payload.targetId);
    const candidates = Object.values(this.world.getSnapshot().characters)
      .filter((character) => character.id !== playerId && character.locationId === sceneId)
      .map((character) => ({ character, runtime: this.states.getRuntimeState(event.sessionId, character.id) }))
      .sort((left, right) => score(right.runtime, playerId) - score(left.runtime, playerId) || left.character.id.localeCompare(right.character.id));
    const eligible = candidates.filter(({ runtime }) => !runtime?.availability || runtime.availability === "free");
    const participants: InteractionParticipant[] = candidates.filter(({ runtime }) => runtime?.availability === "busy" || runtime?.availability === "blocked")
      .map(({ character, runtime }) => ({ characterId: character.id, role: "excluded", reasons: [runtime?.availability === "blocked" ? "blocked" : "busy"] }));
    let lead = targetId && eligible.find(({ character }) => character.id === targetId);
    if (targetId && !lead) participants.push({ characterId: targetId, role: "excluded", reasons: ["explicit_target_not_available"] });
    if (!targetId) lead = eligible[0];
    if (lead) {
      participants.push({ characterId: lead.character.id, role: "lead", reasons: targetId ? ["player_addressed", "present_and_free"] : [...reasons(lead.runtime, playerId), "highest_deterministic_priority"] });
      for (const candidate of eligible.filter(({ character }) => character.id !== lead!.character.id)) participants.push({ characterId: candidate.character.id, role: "support_candidate", reasons: reasons(candidate.runtime, playerId) });
    }
    return { id: randomUUID(), sessionId: event.sessionId, playerId, sceneId, sourceEventId: event.id, sourceActionId: actionId, status: "planned", ...(lead ? { leadCharacterId: lead.character.id } : {}), participants, createdAt: event.createdAt, updatedAt: event.createdAt };
  }
}

function payload(job: DurableJob): { event: GameEvent; playerId: string; responseEventId?: string } { const { event, playerId, responseEventId } = job.payload; if (!event || typeof event !== "object" || typeof playerId !== "string") throw new Error("invalid_interaction_coordinate_payload"); return { event: event as GameEvent, playerId, ...(typeof responseEventId === "string" ? { responseEventId } : {}) }; }
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
function score(runtime: CharacterInteractionRuntimeState | undefined, playerId: string): number { return (runtime?.attention.includes(playerId) ? 100 : 0) + (runtime?.activeGoals.length ?? 0); }
function reasons(runtime: CharacterInteractionRuntimeState | undefined, playerId: string): string[] { return runtime?.attention.includes(playerId) ? ["attention_on_player"] : ["present_and_free"]; }
