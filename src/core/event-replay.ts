import type { GameEvent, GameState, SceneObject } from "./contracts.js";

/** Rebuilds the deterministic v0.2 world slice from an initial snapshot and its complete event stream. */
export function replayGameState(initialState: Readonly<GameState>, events: readonly GameEvent[]): GameState {
  const state: GameState = structuredClone(initialState);
  let previousSequence: number | undefined;
  for (const event of events) {
    if (event.sessionId !== state.sessionId) throw new Error("replay_session_mismatch");
    if (previousSequence !== undefined && event.sequence !== previousSequence + 1) throw new Error("replay_sequence_gap");
    if (event.stateRevision !== state.revision + 1) throw new Error("replay_revision_gap");
    applyEvent(state, event);
    state.revision = event.stateRevision;
    if (event.moment) state.moment = structuredClone(event.moment);
    previousSequence = event.sequence;
  }
  return state;
}

function applyEvent(state: GameState, event: GameEvent): void {
  if (event.type === "character_moved") {
    const characterId = text(event.payload.characterId);
    const destination = text(event.payload.to);
    if (!characterId || !destination || !state.characters[characterId] || !state.locations[destination]) throw new Error("replay_character_move_invalid");
    state.characters[characterId].locationId = destination;
    return;
  }
  if (event.type === "object_interacted") {
    const objectId = text(event.payload.objectId);
    const object = objectId ? state.objects?.[objectId] : undefined;
    const nextState = sceneObjectState(event.payload.state);
    if (!object || !nextState) throw new Error("replay_object_interaction_invalid");
    object.state = nextState;
  }
}

function text(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }

function sceneObjectState(value: unknown): SceneObject["state"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, item]) => typeof item === "string" || typeof item === "boolean" ? [[key, item] as const] : []);
  if (entries.length !== Object.keys(value).length) return undefined;
  return Object.fromEntries(entries) as NonNullable<SceneObject["state"]>;
}
