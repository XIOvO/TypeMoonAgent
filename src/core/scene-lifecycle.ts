import { randomUUID } from "node:crypto";
import type { GameEvent } from "./contracts.js";
import type { DurableJob, DurableJobQueue, EventTaskScheduler } from "./durable-jobs.js";

export type SceneLifecyclePhase = "active" | "battle";
export type SceneLifecycleEventType = "scene_opened" | "interaction_settled" | "scene_closed" | "scene_phase_changed";
export interface SceneLifecycleSnapshot { sessionId: string; playerId: string; sceneId: string; phase: SceneLifecyclePhase; openedAt: string; interactionCount: number; lastInteractionId?: string; updatedAt: string; }
export interface SceneLifecycleEvent { id: string; sessionId: string; playerId: string; sceneId: string; type: SceneLifecycleEventType; sourceEventId: string; sourceActionId?: string; payload: Record<string, unknown>; occurredAt: string; }
export interface SceneLifecycleStore { getSceneLifecycle(sessionId: string, playerId: string): SceneLifecycleSnapshot | undefined; saveSceneLifecycle(snapshot: SceneLifecycleSnapshot): void; recordSceneLifecycleEvent(event: SceneLifecycleEvent): void; hasSceneLifecycleSourceEvent(sourceEventId: string): boolean; }

/** Writes an idempotent lifecycle task beside every relevant confirmed event. */
export class SceneLifecycleScheduler implements EventTaskScheduler {
  public constructor(private readonly jobs: DurableJobQueue, private readonly playerId: string) {}
  public schedule(events: readonly GameEvent[]): void {
    for (const event of events.filter((item) => relevant(item, this.playerId))) this.jobs.enqueue({ id: randomUUID(), sessionId: event.sessionId, kind: "scene.lifecycle", dedupeKey: event.id, payload: { event, playerId: this.playerId }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: event.createdAt, createdAt: event.createdAt });
  }
}

/** Creates derived scene facts only; it never writes GameState or alters the source event. */
export class SceneLifecycleWorker {
  public constructor(private readonly jobs: DurableJobQueue, private readonly store: SceneLifecycleStore) {}
  public async processNext(sessionId: string, now = new Date()): Promise<boolean> {
    const workerId = "scene-lifecycle-worker";
    const job = this.jobs.claim({ sessionId, workerId, kind: "scene.lifecycle", now: now.toISOString(), leaseExpiresBefore: new Date(now.getTime() - 300_000).toISOString() });
    if (!job) return false;
    try {
      const { event, playerId } = payload(job);
      this.jobs.transaction(() => { if (!this.store.hasSceneLifecycleSourceEvent(event.id)) this.project(event, playerId); this.jobs.complete(job.id, workerId, now.toISOString()); });
      return true;
    } catch (error) { this.jobs.retry(job.id, workerId, error instanceof Error ? error.message : "scene_lifecycle_failed", new Date(now.getTime() + 1_000).toISOString()); return true; }
  }
  public async drain(sessionId: string): Promise<number> { let count = 0; while (await this.processNext(sessionId)) count += 1; return count; }
  private project(event: GameEvent, playerId: string): void {
    const locationId = locationFor(event, playerId);
    const current = this.store.getSceneLifecycle(event.sessionId, playerId);
    if (event.type === "character_moved" && event.payload.characterId === playerId) {
      const from = string(event.payload.from); const to = string(event.payload.to); if (!from || !to) return;
      if (current) this.record(event, playerId, current.sceneId, "scene_closed", { reason: "player_moved", to });
      this.store.saveSceneLifecycle({ sessionId: event.sessionId, playerId, sceneId: to, phase: "active", openedAt: event.createdAt, interactionCount: 0, updatedAt: event.createdAt });
      this.record(event, playerId, to, "scene_opened", { reason: "player_arrived", from }); return;
    }
    if (!locationId) return;
    const snapshot = !current || current.sceneId !== locationId
      ? { sessionId: event.sessionId, playerId, sceneId: locationId, phase: "active" as const, openedAt: event.createdAt, interactionCount: 0, updatedAt: event.createdAt }
      : current;
    if (!current || current.sceneId !== locationId) this.record(event, playerId, locationId, "scene_opened", { reason: "first_confirmed_activity" });
    if (event.type === "battle_started" || event.type === "battle_finished") {
      const phase: SceneLifecyclePhase = event.type === "battle_started" ? "battle" : "active";
      this.store.saveSceneLifecycle({ ...snapshot, phase, updatedAt: event.createdAt });
      this.record(event, playerId, locationId, "scene_phase_changed", { phase }); return;
    }
    const actionId = event.causation.playerActionId;
    const interactionCount = actionId && snapshot.lastInteractionId !== actionId ? snapshot.interactionCount + 1 : snapshot.interactionCount;
    this.store.saveSceneLifecycle({ ...snapshot, interactionCount, ...(actionId ? { lastInteractionId: actionId } : {}), updatedAt: event.createdAt });
    if (actionId && snapshot.lastInteractionId !== actionId) this.record(event, playerId, locationId, "interaction_settled", { eventType: event.type, interactionCount }, actionId);
  }
  private record(source: GameEvent, playerId: string, sceneId: string, type: SceneLifecycleEventType, payload: Record<string, unknown>, sourceActionId?: string): void { this.store.recordSceneLifecycleEvent({ id: `${source.id}:${type}`, sessionId: source.sessionId, playerId, sceneId, type, sourceEventId: source.id, ...(sourceActionId ? { sourceActionId } : {}), payload, occurredAt: source.createdAt }); }
}

function relevant(event: GameEvent, playerId: string): boolean { return (event.type === "character_moved" && event.payload.characterId === playerId) || ["player_spoke", "area_observed", "object_inspected", "object_interacted", "time_waited", "battle_started", "battle_finished"].includes(event.type); }
function locationFor(event: GameEvent, playerId: string): string | undefined { if (event.type === "player_spoke" && event.payload.characterId === playerId) return string(event.payload.locationId); if (["area_observed", "time_waited"].includes(event.type) && event.payload.characterId === playerId) return string(event.payload.locationId); if (["object_inspected", "object_interacted", "battle_started", "battle_finished"].includes(event.type)) return string(event.payload.locationId); return undefined; }
function payload(job: DurableJob): { event: GameEvent; playerId: string } { const { event, playerId } = job.payload; if (!event || typeof event !== "object" || typeof playerId !== "string") throw new Error("invalid_scene_lifecycle_payload"); return { event: event as GameEvent, playerId }; }
function string(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value : undefined; }
