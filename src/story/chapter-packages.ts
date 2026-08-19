import type { BranchFact, BranchProgress, PersistedStoryChapterPackage, SessionStoryContext, StoryChapterPackage } from "../core/worldline.js";
import type { GameEvent } from "../core/contracts.js";
import { SqliteCifRepository } from "../cif/sqlite-repository.js";
import type { BranchProjectionRule, BranchRuleProvider } from "./branch-projector.js";

export interface StoryChapterCatalog {
  list(): readonly StoryChapterPackage[];
  get(packageId: string): StoryChapterPackage | undefined;
}

export class StaticStoryChapterCatalog implements StoryChapterCatalog {
  private readonly byId: ReadonlyMap<string, StoryChapterPackage>;
  public constructor(private readonly chapters: readonly StoryChapterPackage[]) {
    this.byId = new Map(chapters.map((chapter) => [chapter.packageId, chapter]));
  }
  public list(): readonly StoryChapterPackage[] { return this.chapters; }
  public get(packageId: string): StoryChapterPackage | undefined { return this.byId.get(packageId); }
}

/** Transactional chapter-context writer, called only from Runtime's turn commit. */
export class StoryChapterPackageService implements BranchRuleProvider {
  public constructor(private readonly repository: SqliteCifRepository) {}

  public commitEntry(input: { sessionId: string; playerId: string; chapter: StoryChapterPackage; now: string; checkpointRevision: number }): void {
    this.repository.deactivateChapterPackages(input.sessionId, input.chapter.contentType, input.chapter.contentId, input.now);
    this.repository.saveStoryChapterPackage({ ...input.chapter, sessionId: input.sessionId, status: "active", activatedAt: input.now });
    this.repository.saveStoryContext({ sessionId: input.sessionId, playerId: input.playerId, canonAnchor: input.chapter.canonAnchor,
      checkpointNodeId: input.chapter.entryNodeId, checkpointRevision: input.checkpointRevision, updatedAt: input.now });
    this.repository.saveBranchProgress({ sessionId: input.sessionId, playerId: input.playerId, contentType: input.chapter.contentType, contentId: input.chapter.contentId,
      activeNodeId: input.chapter.entryNodeId, status: "active", completedNodeIds: [], divertedNodeIds: [], blockedNodeIds: [], updatedAt: input.now });
  }

  /** Resume never recreates world state or resets completed nodes. */
  public resume(sessionId: string, playerId: string, packageId: string): PersistedStoryChapterPackage {
    const chapter = this.repository.listActiveStoryChapterPackages(sessionId).find((candidate) => candidate.packageId === packageId);
    if (!chapter) throw new Error("chapter_not_active");
    const context = this.repository.getStoryContext(sessionId);
    if (!context || context.playerId !== playerId) throw new Error("chapter_player_mismatch");
    return chapter;
  }

  public getContext(sessionId: string, playerId: string): { context: SessionStoryContext; chapters: Array<{ package: PersistedStoryChapterPackage; progress?: BranchProgress }> } | undefined {
    const context = this.repository.getStoryContext(sessionId);
    if (!context || context.playerId !== playerId) return undefined;
    const chapters = this.repository.listActiveStoryChapterPackages(sessionId).map((chapter) => ({
      package: chapter,
      progress: this.repository.getBranchProgress(sessionId, playerId, chapter.contentType, chapter.contentId),
    }));
    return { context, chapters };
  }

  public rulesFor(sessionId: string): readonly BranchProjectionRule[] {
    return this.repository.listActiveStoryChapterPackages(sessionId).flatMap((chapter) => chapter.nodeRules.map((node) => this.compileNode(chapter, node.id)));
  }

  private compileNode(chapter: PersistedStoryChapterPackage, nodeId: string): BranchProjectionRule {
    const node = chapter.nodeRules.find((candidate) => candidate.id === nodeId);
    if (!node) throw new Error("chapter_node_missing");
    return {
      id: `${chapter.packageId}:${node.id}`,
      applies: (event) => this.matches(chapter, node, event),
      effects: (event) => {
        const previous = this.repository.getBranchProgress(event.sessionId, this.contextPlayer(event.sessionId), chapter.contentType, chapter.contentId);
        const progress = toProgress(chapter, node.transition, previous);
        return {
          ...(node.fact ? { fact: node.fact } : {}),
          progress,
        };
      },
    };
  }

  private matches(chapter: PersistedStoryChapterPackage, node: PersistedStoryChapterPackage["nodeRules"][number], event: GameEvent): boolean {
    const summonMatch = node.summon && event.type === "story_summon_opened"
      && event.payload.packageId === chapter.packageId && event.payload.nodeId === node.id && event.payload.characterId === node.summon.characterId;
    if (!summonMatch && (event.type !== node.when.type || !matchesPayload(event.payload, node.when.payloadEquals))) return false;
    const context = this.repository.getStoryContext(event.sessionId);
    if (!context) return false;
    const progress = this.repository.getBranchProgress(event.sessionId, context.playerId, chapter.contentType, chapter.contentId);
    if (progress?.status !== "active" || progress.activeNodeId !== node.id) return false;
    return (node.requiresFacts ?? []).every((requirement) => sameJson(this.repository.getBranchFact(event.sessionId, requirement.factKey)?.value, requirement.valueEquals));
  }

  private contextPlayer(sessionId: string): string {
    const context = this.repository.getStoryContext(sessionId);
    if (!context) throw new Error("chapter_story_context_missing");
    return context.playerId;
  }
}

function matchesPayload(payload: Record<string, unknown>, expected: Record<string, string | number | boolean> | undefined): boolean {
  return !expected || Object.entries(expected).every(([key, value]) => payload[key] === value);
}
function sameJson(left: Record<string, unknown> | undefined, right: Record<string, unknown>): boolean { return JSON.stringify(left) === JSON.stringify(right); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function toProgress(chapter: PersistedStoryChapterPackage, transition: PersistedStoryChapterPackage["nodeRules"][number]["transition"], previous: BranchProgress | undefined): Omit<BranchProgress, "sessionId" | "playerId" | "updatedAt"> {
  return {
    contentType: chapter.contentType, contentId: chapter.contentId, status: transition.status, activeNodeId: transition.activeNodeId,
    completedNodeIds: unique([...(previous?.completedNodeIds ?? []), ...(transition.completeNodeIds ?? [])]),
    divertedNodeIds: unique([...(previous?.divertedNodeIds ?? []), ...(transition.divertNodeIds ?? [])]),
    blockedNodeIds: unique([...(previous?.blockedNodeIds ?? []), ...(transition.blockNodeIds ?? [])]),
  };
}
