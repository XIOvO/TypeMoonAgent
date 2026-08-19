import { SqliteLoreRepository } from "../lore/sqlite-repository.js";
import type { ServantProfileEvidence } from "../lore/types.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

/** Enforces player-facing unlock conditions before profile evidence reaches an LLM. */
export class ServantProfileAccessPolicy {
  public constructor(private readonly lore: SqliteLoreRepository, private readonly game: SqliteCifRepository) {}

  public listVisible(input: { sessionId: string; playerId: string; characterId: string; region: string; names: string[]; limit?: number }): ServantProfileEvidence[] {
    const bondLevel = this.game.getBond(input.sessionId, input.playerId, input.characterId)?.level ?? 1;
    return this.lore.listServantProfileEvidence({ region: input.region, names: input.names, limit: (input.limit ?? 4) * 8 })
      .filter((entry) => this.isUnlocked(entry.unlockCondition, bondLevel)).slice(0, input.limit ?? 4);
  }

  private isUnlocked(condition: Record<string, unknown>, bondLevel: number): boolean {
    const type = String(condition.type ?? "none");
    if (type === "none") return true;
    if (type !== "svtFriendship") return false;
    const required = Array.isArray(condition.values) ? Number(condition.values[0] ?? 0) : 0;
    return Number.isFinite(required) && bondLevel >= required;
  }
}
