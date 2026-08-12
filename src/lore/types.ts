export interface ScriptDocumentInput {
  id: string;
  source: "atlas";
  region: string;
  scriptId: string;
  warId?: number;
  questId?: number;
  questName?: string;
  phase?: number;
  sourceUrl: string;
  localPath: string;
  contentSha1: string;
  sourceSha1?: string;
  byteSize: number;
  fetchedAt: string;
}

export interface ScriptChunkInput {
  id: string;
  documentId: string;
  chunkOrder: number;
  text: string;
  speakerNames: string[];
}

export interface ScriptSearchResult {
  id: string;
  documentId: string;
  scriptId: string;
  warId?: number;
  questId?: number;
  questName?: string;
  chunkOrder: number;
  text: string;
  speakerNames: string[];
  matchKind: "fts" | "substring";
}
