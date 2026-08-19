export type CanonContentKind = "main" | "interlude" | "event" | "servant_profile";

/** Stable source hierarchy imported from Atlas; it is separate from player progress. */
export interface CanonStoryCollectionInput {
  id: string; region: string; atlasWarId: number;
  contentKind: Exclude<CanonContentKind, "servant_profile">;
  name: string; longName?: string; atlasEventId?: number;
}

export interface CanonLocationInput {
  id: string; collectionId: string; atlasSpotId: number; name: string; atlasMapId?: number;
}

export interface CanonStoryNodeInput {
  id: string; collectionId: string; locationId?: string; atlasQuestId: number; name: string;
  questType: string; chapterId?: number; chapterSubId?: number; chapterSubTitle?: string;
  contentKind: Exclude<CanonContentKind, "servant_profile">; unlockKey: string;
}

export interface CanonStoryPhaseInput { id: string; storyNodeId: string; phase: number; scriptIds: string[]; }

export interface ScriptDocumentInput {
  id: string; source: "atlas"; region: string; scriptId: string; storyNodeId?: string; phaseId?: string;
  contentKind: CanonContentKind; sourceUrl: string; localPath: string; contentSha1: string;
  sourceSha1?: string; byteSize: number; fetchedAt: string;
}

export interface CanonCharacterInput {
  id: string; region: string; atlasSvtId?: number; atlasCharaId?: number;
  displayName: string; normalizedName: string;
}

/** Static My Room / Servant Profile data. It is canon evidence, never live CIF state. */
export interface CanonServantProfileInput {
  id: string; documentId: string; region: string; atlasServantId: number; collectionNo?: number;
  displayName: string; originalName?: string; className?: string; rarity?: number; gender?: string; attribute?: string;
  cv?: string; illustrator?: string; parameters: Record<string, unknown>; profileJson: Record<string, unknown>;
}

export interface CanonServantProfileEntryInput {
  id: string; profileId: string; entryOrder: number; sourceEntryId?: number; priority: number;
  unlockCondition: Record<string, unknown>; text: string;
}

export interface CanonAppearanceInput {
  sceneId: string; characterId: string; slot?: string;
  appearanceKind: "chara_set" | "speaker"; displayName: string;
}

export interface CanonDialogueInput {
  id: string; sceneId: string; dialogueOrder: number; speakerName?: string;
  speakerCharacterId?: string; text: string; rawStartLine: number; rawEndLine: number;
}

export interface CanonSceneInput {
  id: string; documentId: string; sceneOrder: number; atlasSceneId?: string;
  rawStartLine: number; rawEndLine: number; appearances: CanonAppearanceInput[];
  dialogues: CanonDialogueInput[];
}

export interface CanonFragmentInput {
  id: string; documentId: string; sceneId?: string; fragmentOrder: number; text: string;
  speakerNames: string[]; dialogueIds: string[]; spoilerUnlockKey: string;
}

export interface CanonDocumentBundle { document: ScriptDocumentInput; scenes: CanonSceneInput[]; fragments: CanonFragmentInput[]; }

/** Kept for existing CIF evidence consumers while Lore switches from chunks to fragments. */
export interface ScriptSearchResult {
  id: string; documentId: string; scriptId: string; warId?: number; questId?: number;
  questName?: string; phase?: number; contentKind: CanonContentKind; sceneId?: string;
  chunkOrder: number; text: string; speakerNames: string[]; dialogueIds: string[];
  spoilerUnlockKey: string; matchKind: "fts" | "substring";
}

/** A Servant Profile fragment with the original My Room unlock rule attached. */
export interface ServantProfileEvidence {
  id: string; documentId: string; scriptId: string; displayName: string; text: string;
  entryOrder: number; unlockCondition: Record<string, unknown>;
}

export interface LoreImportReport {
  collections: number; locations: number; storyNodes: number; phases: number; documents: number;
  scenes: number; dialogues: number; fragments: number;
}
