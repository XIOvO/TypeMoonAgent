import type { BattleCombatant, GameState } from "../core/contracts.js";

/** The browser receives this projection, never the raw database record. */
export interface PlayerVisibleState {
  sessionId: string;
  revision: number;
  scene: { locationId: string; exits: string[] };
  objects: Array<{ id: string; kind: string; tags: string[]; state: Record<string, unknown> }>;
  characters: Array<{ id: string; locationId: string; mood: string }>;
  battle?: {
    id: string;
    status: string;
    turn: number;
    objective: string;
    outcome?: string;
    allies: BattleCombatant[];
    enemies: BattleCombatant[];
  };
}

export function buildPlayerVisibleState(state: GameState, playerId: string): PlayerVisibleState {
  const player = state.characters[playerId];
  if (!player) throw new Error("unknown_player");
  const location = state.locations[player.locationId];
  if (!location) throw new Error("unknown_player_location");
  return {
    sessionId: state.sessionId,
    revision: state.revision,
    scene: { locationId: location.id, exits: [...location.exits] },
    objects: Object.values(state.objects ?? {}).filter((object) => object.locationId === location.id && object.visible)
      .map((object) => ({ id: object.id, kind: object.kind, tags: [...object.tags], state: { ...(object.state ?? {}) } })),
    characters: Object.values(state.characters)
      .filter((character) => character.id === playerId || character.locationId === location.id)
      .map(({ id, locationId, mood }) => ({ id, locationId, mood })),
    battle: state.battle ? {
      id: state.battle.id, status: state.battle.status, turn: state.battle.turn,
      objective: state.battle.objective, outcome: state.battle.outcome,
      allies: Object.values(state.battle.allies).map((combatant) => structuredClone(combatant)),
      enemies: Object.values(state.battle.enemies).map((combatant) => structuredClone(combatant)),
    } : undefined,
  };
}
