import type { BranchProgress, PersistedStoryChapterPackage, SessionStoryContext, StoryChapterPackage } from "./worldline.js";

/** Public chapter operations consumed by HTTP and future presentation plugins. */
export interface StoryChapterController {
  list(): readonly StoryChapterPackage[];
  getContext(sessionId: string, playerId: string): { context: SessionStoryContext; chapters: Array<{ package: PersistedStoryChapterPackage; progress?: BranchProgress }> } | undefined;
  enter(input: { id: string; sessionId: string; playerId: string; packageId: string; mode: "new" | "resume" | "assumed_start" }): Promise<void>;
}
