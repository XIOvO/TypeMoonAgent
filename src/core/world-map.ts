import type { GameState } from "./contracts.js";
import type { WorldStateReader } from "./world-state.js";

export type MapLocation = GameState["locations"][string];

/** Read-only spatial topology projected from the latest committed world state. */
export interface WorldMap {
  getLocation(locationId: string): MapLocation | undefined;
  getConnectedLocationIds(locationId: string): readonly string[];
}

export class StateBackedWorldMap implements WorldMap {
  public constructor(private readonly worldState: WorldStateReader) {}

  public getLocation(locationId: string): MapLocation | undefined {
    const location = this.worldState.getSnapshot().locations[locationId];
    return location && structuredClone(location);
  }

  public getConnectedLocationIds(locationId: string): readonly string[] {
    return [...(this.getLocation(locationId)?.exits ?? [])].sort();
  }
}
