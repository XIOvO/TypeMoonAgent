import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SqliteLoreRepository } from "./sqlite-repository.js";
import type { ScriptChunkInput, ScriptDocumentInput } from "./types.js";

interface AtlasManifest {
  region: string;
  war: { id: number };
  fetchedAt: string;
  scripts: Array<{ scriptId: string; url: string; questId: number; questName: string; phase: number; localPath: string; contentSha1: string; sourceSha1?: string; bytes: number }>;
}

export async function importAtlasManifest(input: { repository: SqliteLoreRepository; sourceRoot: string; manifestPath: string; maxCharacters?: number }): Promise<{ documents: number; chunks: number }> {
  const manifest = JSON.parse(await readFile(input.manifestPath, "utf8")) as AtlasManifest;
  let chunks = 0;
  for (const script of manifest.scripts) {
    const text = await readFile(join(input.sourceRoot, script.localPath), "utf8");
    const documentId = `atlas:${manifest.region}:script:${script.scriptId}`;
    const parts = chunkScript(documentId, text, input.maxCharacters ?? 650);
    const document: ScriptDocumentInput = {
      id: documentId, source: "atlas", region: manifest.region, scriptId: script.scriptId, warId: manifest.war.id,
      questId: script.questId, questName: script.questName, phase: script.phase, sourceUrl: script.url,
      localPath: script.localPath, contentSha1: script.contentSha1, sourceSha1: script.sourceSha1,
      byteSize: script.bytes, fetchedAt: manifest.fetchedAt,
    };
    input.repository.replaceDocument(document, parts);
    chunks += parts.length;
  }
  return { documents: manifest.scripts.length, chunks };
}

export function chunkScript(documentId: string, rawText: string, maxCharacters: number): ScriptChunkInput[] {
  const blocks = rawText.replace(/\r\n/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter((block) => block && !/^\[/.test(block));
  const chunks: Array<{ text: string; speakers: Set<string> }> = [];
  let text = "";
  let speakers = new Set<string>();
  const push = () => {
    if (!text) return;
    chunks.push({ text, speakers }); text = ""; speakers = new Set<string>();
  };
  for (const block of blocks) {
    const blockSpeakers = [...block.matchAll(/＠[^：\n]+：([^\n]+)/g)].map((match) => match[1].trim()).filter(Boolean);
    const cleaned = block.replace(/\[(?:r|line \d+|k)\]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    if (text && text.length + cleaned.length + 1 > maxCharacters) push();
    text = text ? `${text}\n${cleaned}` : cleaned;
    for (const speaker of blockSpeakers) speakers.add(speaker);
  }
  push();
  return chunks.map((chunk, index) => ({
    id: `${documentId}:chunk:${String(index + 1).padStart(4, "0")}`,
    documentId, chunkOrder: index + 1, text: chunk.text, speakerNames: [...chunk.speakers],
  }));
}
