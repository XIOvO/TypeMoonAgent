import type { GameState } from "./contracts.js";

/** Read-only committed-world access granted to game plugins. */
export interface WorldStateReader {
  getSnapshot(): Readonly<GameState>;
  subscribe(listener: WorldStateListener): () => void;
}

/** Internal Runtime-to-store handoff. It is not a plugin capability. */
export interface WorldStatePublisher {
  publishCommittedState(state: Readonly<GameState>): void;
}

export type WorldStateListener = (state: Readonly<GameState>) => void;

/**
 * In-memory projection of the latest successfully committed world snapshot.
 * It deliberately accepts writes only through WorldStatePublisher.
 */
export class WorldStateStore implements WorldStateReader, WorldStatePublisher {
  private readonly listeners = new Set<WorldStateListener>();
  private snapshot: GameState;
  private closed = false;

  public constructor(initialState: Readonly<GameState>) {
    this.snapshot = structuredClone(initialState);
  }

  public getSnapshot(): Readonly<GameState> {
    return structuredClone(this.snapshot);
  }

  public subscribe(listener: WorldStateListener): () => void {
    if (this.closed) throw new Error("World state store has been disposed.");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public publishCommittedState(state: Readonly<GameState>): void {
    if (this.closed) return;
    this.snapshot = structuredClone(state);
    for (const listener of this.listeners) {
      try {
        listener(this.getSnapshot());
      } catch {
        // State observers cannot invalidate an already committed game turn.
      }
    }
  }

  public close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}
