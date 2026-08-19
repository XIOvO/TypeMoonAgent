import { randomUUID } from "node:crypto";
import type { GameEvent } from "../core/contracts.js";
import type { BranchEventProjector, BranchFact, BranchProgress, SessionStoryContext, WorldlineDivergence } from "../core/worldline.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";

export interface BranchProjectionRule {
  id: string;
  applies(event: GameEvent): boolean;
  /** The rule author supplies only confirmed facts; the projector persists them atomically with the turn. */
  effects(event: GameEvent, context: SessionStoryContext): {
    fact?: Omit<BranchFact, "id" | "sessionId" | "sourceEventIds" | "updatedAt"> & { canonBaseline?: Record<string, unknown>; divergence?: Omit<WorldlineDivergence, "id" | "sessionId" | "canonAnchor" | "sourceEventIds" | "changedFactKey" | "canonBaseline" | "branchReality" | "createdAt" | "updatedAt"> };
    progress?: Omit<BranchProgress, "sessionId" | "playerId" | "updatedAt">;
  };
}

export interface BranchRuleProvider {
  rulesFor(sessionId: string): readonly BranchProjectionRule[];
}

/**
 * Bridges confirmed events to player-world projections. No LLM enters this
 * path: a rule either matches objective event data or it does nothing.
 */
export class BranchWorldlineProjector implements BranchEventProjector {
  public constructor(private readonly repository: SqliteCifRepository, private readonly rules: readonly BranchProjectionRule[] | BranchRuleProvider) {}

  public initialize(context: SessionStoryContext, progress: readonly BranchProgress[] = []): void {
    this.repository.transaction(() => {
      this.repository.saveStoryContext(context);
      for (const entry of progress) this.repository.saveBranchProgress(entry);
    });
  }

  public project(events: readonly GameEvent[]): void {
    if (!events.length) return;
    const context = this.repository.getStoryContext(events[0]!.sessionId);
    if (!context) return;
    for (const event of events) {
      const now = event.createdAt;
      for (const rule of this.rulesFor(event.sessionId)) {
        if (!rule.applies(event)) continue;
        const effect = rule.effects(event, context);
        if (effect.fact) this.applyFact(effect.fact, event, context, now);
        if (effect.progress) this.repository.saveBranchProgress({ ...effect.progress, sessionId: context.sessionId, playerId: context.playerId, updatedAt: now });
      }
      this.repository.saveStoryContext({ ...context, checkpointRevision: event.stateRevision, updatedAt: now });
    }
  }

  private rulesFor(sessionId: string): readonly BranchProjectionRule[] {
    return "rulesFor" in this.rules ? this.rules.rulesFor(sessionId) : this.rules;
  }

  private applyFact(effect: NonNullable<ReturnType<BranchProjectionRule["effects"]>["fact"]>, event: GameEvent, context: SessionStoryContext, now: string): void {
    const fact: BranchFact = { id: randomUUID(), sessionId: context.sessionId, factKey: effect.factKey, value: effect.value, sourceEventIds: [event.id], updatedAt: now };
    this.repository.saveBranchFact(fact);
    if (!effect.canonBaseline || sameJson(effect.canonBaseline, effect.value)) return;
    const divergence = effect.divergence;
    if (!divergence) return;
    this.repository.saveWorldlineDivergence({
      id: randomUUID(), sessionId: context.sessionId, canonAnchor: context.canonAnchor, sourceEventIds: [event.id], changedFactKey: fact.factKey,
      canonBaseline: effect.canonBaseline, branchReality: effect.value, ...divergence, createdAt: now, updatedAt: now,
    });
  }
}

function sameJson(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
