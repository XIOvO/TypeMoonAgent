import type { SceneNarrativeProjection } from "../cif/types.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";

/** The continuity slice a future GM reads alongside Runtime facts and Lore. */
export interface GmSceneContext {
  recentContinuity: SceneNarrativeProjection[];
  openThreads: string[];
  storyPressures: string[];
}

export class GmSceneContextBuilder {
  public constructor(private readonly repository: SqliteCifRepository) {}

  public build(sessionId: string, limit = 6): GmSceneContext {
    const recentContinuity = this.repository.listSceneNarrativeProjections(sessionId, limit);
    return {
      recentContinuity,
      openThreads: unique(recentContinuity.flatMap((projection) => projection.openThreads)),
      storyPressures: unique(recentContinuity.flatMap((projection) => projection.storyPressures)),
    };
  }
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
