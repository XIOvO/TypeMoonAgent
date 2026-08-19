import { Service, type Context } from "@deepseek-ai/cordis";
import { SqliteCifRepository } from "../../cif/sqlite-repository.js";
import type { ActionResult, GameEvent, GameState } from "../../core/contracts.js";
import type { EventTaskScheduler } from "../../core/durable-jobs.js";
import type { BranchEventProjector } from "../../core/worldline.js";
import { SqliteTurnCommitter, type PendingTurnCommit, type TurnCommitter } from "../../persistence/turn-commit.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";

export const WORLD_EVENT_HISTORY_CAPABILITY = "world.eventHistory";
/** System-only capability. Feature plugins must not request this write port. */
export const SYSTEM_TURN_COMMITTER_CAPABILITY = "system.turnCommitter";

/** Read-only persisted facts available to future feature plugins. */
export interface WorldEventHistory {
  loadWorldState(sessionId: string): GameState | undefined;
  getProcessedActionResult(actionId: string, requestFingerprint: string): ActionResult | undefined;
  listEventsByIds(sessionId: string, eventIds: readonly string[]): GameEvent[];
}

export interface SqlitePersistenceDependencies {
  eventTasks: EventTaskScheduler;
  worldline?: BranchEventProjector;
}

/** Bootstrap-only handles used to construct the compatible Runtime. */
export interface SqlitePersistenceSystem {
  plugin: CordisGamePluginDefinition;
  turnCommitter: TurnCommitter;
  history: WorldEventHistory;
}

class SqliteWorldEventHistory implements WorldEventHistory {
  public constructor(private readonly repository: SqliteCifRepository) {}
  public loadWorldState(sessionId: string): GameState | undefined {
    const state = this.repository.loadWorldState(sessionId);
    return state && structuredClone(state);
  }
  public getProcessedActionResult(actionId: string, requestFingerprint: string): ActionResult | undefined {
    const result = this.repository.getProcessedActionResult(actionId, requestFingerprint);
    return result && structuredClone(result);
  }
  public listEventsByIds(sessionId: string, eventIds: readonly string[]): GameEvent[] {
    return structuredClone(this.repository.listObjectiveHistoryByIds(sessionId, eventIds));
  }
}

class WorldEventHistoryService extends Service implements WorldEventHistory {
  public constructor(ctx: Context, private readonly history: WorldEventHistory) { super(ctx, "worldEventHistory"); }
  public loadWorldState(sessionId: string) { return this.history.loadWorldState(sessionId); }
  public getProcessedActionResult(actionId: string, requestFingerprint: string) { return this.history.getProcessedActionResult(actionId, requestFingerprint); }
  public listEventsByIds(sessionId: string, eventIds: readonly string[]) { return this.history.listEventsByIds(sessionId, eventIds); }
}

class TurnCommitterService extends Service implements TurnCommitter {
  public constructor(ctx: Context, private readonly committer: TurnCommitter) { super(ctx, "systemTurnCommitter"); }
  public commit(turn: PendingTurnCommit): void { this.committer.commit(turn); }
  public getProcessedActionResult(actionId: string, requestFingerprint: string) { return this.committer.getProcessedActionResult?.(actionId, requestFingerprint); }
}

/**
 * Owns the SQLite transaction boundary. The returned handle exists only to
 * build the current compatible Runtime; mounted plugins consume capabilities.
 */
export function createSqlitePersistenceSystem(repository: SqliteCifRepository, dependencies: SqlitePersistenceDependencies): SqlitePersistenceSystem {
  const history = new SqliteWorldEventHistory(repository);
  const turnCommitter = new SqliteTurnCommitter(repository, undefined, dependencies.worldline, dependencies.eventTasks);
  return {
    turnCommitter,
    history,
    plugin: {
      manifest: {
        id: "system.persistence",
        version: "1.0.0",
        configVersion: 1,
        requires: ["world.eventTasks"],
        provides: [
          { id: WORLD_EVENT_HISTORY_CAPABILITY, serviceKey: "worldEventHistory" },
          { id: SYSTEM_TURN_COMMITTER_CAPABILITY, serviceKey: "systemTurnCommitter", scope: "system" },
        ],
      },
      implementation: (ctx: Context) => {
        new WorldEventHistoryService(ctx, history);
        new TurnCommitterService(ctx, turnCommitter);
      },
    },
  };
}
