import type { GameState } from "./contracts.js";

export type NavigationRoute =
  | { kind: "already_there" }
  | { kind: "reachable"; steps: readonly string[] }
  | { kind: "unreachable"; reason: "unknown_origin" | "unknown_destination" | "no_route" };

/** Pure route planner used by Runtime and background candidate selection. */
export interface NavigationPlanner {
  findRoute(world: Pick<GameState, "locations">, from: string, destination: string): NavigationRoute;
}

export class ExitGraphNavigationPlanner implements NavigationPlanner {
  public findRoute(world: Pick<GameState, "locations">, from: string, destination: string): NavigationRoute {
    if (!world.locations[from]) return { kind: "unreachable", reason: "unknown_origin" };
    if (!world.locations[destination]) return { kind: "unreachable", reason: "unknown_destination" };
    if (from === destination) return { kind: "already_there" };
    const queue = [from];
    const previous = new Map<string, string>();
    previous.set(from, "");
    while (queue.length) {
      const current = queue.shift()!;
      for (const next of [...world.locations[current]!.exits].sort()) {
        if (!world.locations[next] || previous.has(next)) continue;
        previous.set(next, current);
        if (next === destination) return { kind: "reachable", steps: buildSteps(previous, from, destination) };
        queue.push(next);
      }
    }
    return { kind: "unreachable", reason: "no_route" };
  }
}

export const exitGraphNavigation = new ExitGraphNavigationPlanner();

/** Returns the first hop of a deterministic shortest route, never a teleport. */
export function nextStepToward(world: Pick<GameState, "locations">, from: string, destination: string): string | undefined {
  const route = exitGraphNavigation.findRoute(world, from, destination);
  return route.kind === "reachable" ? route.steps[0] : undefined;
}

function buildSteps(previous: ReadonlyMap<string, string>, from: string, destination: string): string[] {
  const reverse: string[] = [];
  let current = destination;
  while (current !== from) {
    reverse.push(current);
    current = previous.get(current)!;
  }
  return reverse.reverse();
}
