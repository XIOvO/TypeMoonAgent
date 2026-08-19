import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SqliteLoreRepository } from "./sqlite-repository.js";
import type {
  CanonContentKind, CanonDocumentBundle, CanonFragmentInput, CanonSceneInput, LoreImportReport,
} from "./types.js";

interface AtlasManifest {
  region: string;
  fetchedAt: string;
  war?: { id: number; name: string; longName?: string; eventId?: number };
  scripts: Array<{
    scriptId: string; url: string; questId: number; questName: string; phase: number; localPath: string;
    contentSha1: string; sourceSha1?: string; bytes: number; warId?: number; warName?: string; warLongName?: string;
    eventId?: number; spotId?: number; spotName?: string; mapId?: number; questType?: string;
    chapterId?: number; chapterSubId?: number; chapterSubStr?: string; contentKind?: CanonContentKind;
  }>;
}

const normalizeName = (name: string): string => name.replace(/\s+/g, "").replace(/[·・]/g, "").trim();
const collectionId = (region: string, warId: number) => `atlas:${region}:war:${warId}`;
const locationId = (region: string, spotId: number) => `atlas:${region}:spot:${spotId}`;
const nodeId = (region: string, questId: number) => `atlas:${region}:quest:${questId}`;
const phaseId = (region: string, questId: number, phase: number) => `atlas:${region}:quest:${questId}:phase:${phase}`;
const characterId = (region: string, name: string) => `atlas:${region}:character:${normalizeName(name)}`;

function contentKind(script: AtlasManifest["scripts"][number]): Exclude<CanonContentKind, "servant_profile"> {
  if (script.contentKind && script.contentKind !== "servant_profile") return script.contentKind;
  if (script.questType === "friendship") return "interlude";
  return script.eventId ? "event" : "main";
}

export async function importAtlasManifest(input: { repository: SqliteLoreRepository; sourceRoot: string; manifestPath: string; maxCharacters?: number }): Promise<LoreImportReport> {
  const manifest = JSON.parse(await readFile(input.manifestPath, "utf8")) as AtlasManifest;
  const seen = { collections: new Set<string>(), locations: new Set<string>(), nodes: new Set<string>(), phases: new Set<string>() };
  const scriptsByPhase = new Map<string, string[]>();
  for (const script of manifest.scripts) {
    const key = `${script.questId}:${script.phase}`;
    scriptsByPhase.set(key, [...(scriptsByPhase.get(key) ?? []), script.scriptId]);
  }
  let scenes = 0; let dialogues = 0; let fragments = 0; let processed = 0;
  for (const script of manifest.scripts) {
    const warId = script.warId ?? manifest.war?.id;
    if (warId === undefined) throw new Error(`Atlas script ${script.scriptId} has no warId`);
    const kind = contentKind(script); const collection = collectionId(manifest.region, warId);
    input.repository.upsertCollection({ id: collection, region: manifest.region, atlasWarId: warId, contentKind: kind,
      name: script.warName ?? manifest.war?.name ?? `War ${warId}`, longName: script.warLongName ?? manifest.war?.longName,
      atlasEventId: script.eventId ?? manifest.war?.eventId });
    seen.collections.add(collection);
    const node = nodeId(manifest.region, script.questId);
    let location: string | undefined;
    if (script.spotId !== undefined) {
      location = locationId(manifest.region, script.spotId);
      input.repository.upsertLocation({ id: location, collectionId: collection, atlasSpotId: script.spotId,
        name: script.spotName ?? `Spot ${script.spotId}`, atlasMapId: script.mapId });
      seen.locations.add(location);
    }
    input.repository.upsertStoryNode({ id: node, collectionId: collection, locationId: location, atlasQuestId: script.questId,
      name: script.questName, questType: script.questType ?? "unknown", chapterId: script.chapterId,
      chapterSubId: script.chapterSubId, chapterSubTitle: script.chapterSubStr, contentKind: kind,
      unlockKey: `atlas:${manifest.region}:quest:${script.questId}:phase:${script.phase}` });
    seen.nodes.add(node);
    const phase = phaseId(manifest.region, script.questId, script.phase);
    input.repository.upsertPhase({ id: phase, storyNodeId: node, phase: script.phase, scriptIds: scriptsByPhase.get(`${script.questId}:${script.phase}`) ?? [script.scriptId] });
    seen.phases.add(phase);
    const documentId = `atlas:${manifest.region}:script:${script.scriptId}`;
    const document = { id: documentId, source: "atlas" as const, region: manifest.region, scriptId: script.scriptId, storyNodeId: node,
      phaseId: phase, contentKind: kind, sourceUrl: script.url, localPath: script.localPath, contentSha1: script.contentSha1,
      sourceSha1: script.sourceSha1, byteSize: script.bytes, fetchedAt: manifest.fetchedAt };
    if (input.repository.hasDocumentContent(documentId, script.contentSha1)) { processed += 1; continue; }
    const rawText = await readFile(join(input.sourceRoot, script.localPath), "utf8");
    const bundle = parseAtlasScript({ documentId, region: manifest.region, rawText, maxCharacters: input.maxCharacters ?? 650, document });
    for (const scene of bundle.scenes) for (const appearance of scene.appearances) {
      input.repository.upsertCharacter({ id: appearance.characterId, region: manifest.region,
        atlasCharaId: /^\d+$/.test(appearance.slot ?? "") ? Number(appearance.slot) : undefined,
        displayName: appearance.displayName, normalizedName: normalizeName(appearance.displayName) });
    }
    input.repository.replaceDocument(bundle);
    scenes += bundle.scenes.length; dialogues += bundle.scenes.reduce((total, scene) => total + scene.dialogues.length, 0); fragments += bundle.fragments.length;
    processed += 1;
    if (processed % 100 === 0 || processed === manifest.scripts.length) console.log(JSON.stringify({ stage: "indexing", processed, total: manifest.scripts.length, scenes, dialogues, fragments }));
  }
  return { collections: seen.collections.size, locations: seen.locations.size, storyNodes: seen.nodes.size, phases: seen.phases.size,
    documents: manifest.scripts.length, scenes, dialogues, fragments };
}

function cleanDialogueText(lines: string[]): string {
  return lines.join("\n").replace(/\[r\]/g, "\n").replace(/\[(?:line\s+\d+|k|[-\w.]+(?:\s+[^\]]*)?)\]/gi, "")
    .replace(/\s*\n\s*/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function speakerFromHeader(line: string): string | undefined {
  const raw = line.slice(1).replace(/\[[^\]]*\]/g, "").trim();
  const value = raw.includes("：") || raw.includes(":") ? raw.split(/[：:]/, 2)[1] ?? "" : raw;
  return value || undefined;
}

/** Parses Atlas Script command text into source scenes, dialogue rows, appearances and retrievable fragments. */
export function parseAtlasScript(input: { documentId: string; region: string; rawText: string; maxCharacters: number; document: CanonDocumentBundle["document"] }): CanonDocumentBundle {
  const lines = input.rawText.replace(/\r\n/g, "\n").split("\n");
  const scenes: CanonSceneInput[] = []; let current: CanonSceneInput | undefined;
  let sceneOrder = 0; let dialogueOrder = 0; const visibleCharacters = new Map<string, { id: string; slot: string }>();
  const beginScene = (atlasSceneId: string | undefined, line: number) => {
    if (current) current.rawEndLine = line - 1;
    current = { id: `${input.documentId}:scene:${String(++sceneOrder).padStart(4, "0")}`, documentId: input.documentId,
      sceneOrder, atlasSceneId, rawStartLine: line, rawEndLine: lines.length, appearances: [], dialogues: [] };
    scenes.push(current); visibleCharacters.clear(); dialogueOrder = 0;
  };
  const ensureScene = (line: number) => { if (!current) beginScene(undefined, line); return current!; };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""; const lineNumber = index + 1;
    const sceneMatch = line.match(/^\[scene\s+([^\]\s]+).*\]$/i);
    if (sceneMatch) { beginScene(sceneMatch[1], lineNumber); continue; }
    const charaMatch = line.match(/^\[charaSet\s+(\S+)\s+(\d+)\s+\d+\s+([^\]]+)\]$/i);
    if (charaMatch) {
      const scene = ensureScene(lineNumber); const slot = charaMatch[1]!; const name = charaMatch[3]!.trim(); const id = characterId(input.region, name);
      visibleCharacters.set(normalizeName(name), { id, slot: charaMatch[2]! });
      scene.appearances.push({ sceneId: scene.id, characterId: id, slot: charaMatch[2], appearanceKind: "chara_set", displayName: name });
      continue;
    }
    if (!line.startsWith("＠")) continue;
    const scene = ensureScene(lineNumber); const speakerName = speakerFromHeader(line); const textLines: string[] = [];
    let end = lineNumber;
    for (index += 1; index < lines.length; index += 1) {
      const candidate = lines[index] ?? ""; end = index + 1;
      if (/^\[k\]/i.test(candidate)) break;
      if (/^＠/.test(candidate) || /^\[scene\s+/i.test(candidate)) { index -= 1; end = index + 1; break; }
      textLines.push(candidate);
    }
    const text = cleanDialogueText(textLines); if (!text) continue;
    const mapped = speakerName ? visibleCharacters.get(normalizeName(speakerName)) : undefined;
    const dialogueId = `${scene.id}:dialogue:${String(++dialogueOrder).padStart(4, "0")}`;
    scene.dialogues.push({ id: dialogueId, sceneId: scene.id, dialogueOrder, speakerName, speakerCharacterId: mapped?.id,
      text, rawStartLine: lineNumber, rawEndLine: end });
    if (speakerName && !mapped) scene.appearances.push({ sceneId: scene.id, characterId: characterId(input.region, speakerName),
      appearanceKind: "speaker", displayName: speakerName });
  }
  if (!scenes.length) beginScene(undefined, 1);
  const fragments = fragmentScenes(input.documentId, scenes, input.maxCharacters, input.document.phaseId ?? input.document.id);
  return { document: input.document, scenes, fragments };
}

function fragmentScenes(documentId: string, scenes: CanonSceneInput[], maxCharacters: number, spoilerUnlockKey: string): CanonFragmentInput[] {
  const fragments: CanonFragmentInput[] = []; let order = 0;
  for (const scene of scenes) {
    let lines: string[] = []; let speakers = new Set<string>(); let dialogueIds: string[] = [];
    const push = () => { if (!lines.length) return; fragments.push({ id: `${documentId}:fragment:${String(++order).padStart(4, "0")}`,
      documentId, sceneId: scene.id, fragmentOrder: order, text: lines.join("\n"), speakerNames: [...speakers], dialogueIds, spoilerUnlockKey });
      lines = []; speakers = new Set<string>(); dialogueIds = []; };
    for (const dialogue of scene.dialogues) {
      const rendered = dialogue.speakerName ? `${dialogue.speakerName}：${dialogue.text}` : dialogue.text;
      if (lines.length && lines.join("\n").length + rendered.length + 1 > maxCharacters) push();
      lines.push(rendered); if (dialogue.speakerName) speakers.add(dialogue.speakerName); dialogueIds.push(dialogue.id);
    }
    push();
  }
  return fragments;
}

/** Legacy test helper retained while callers move from opaque chunks to source-linked fragments. */
export function chunkScript(documentId: string, rawText: string, maxCharacters: number): CanonFragmentInput[] {
  return parseAtlasScript({ documentId, region: "CN", rawText, maxCharacters, document: {
    id: documentId, source: "atlas", region: "CN", scriptId: documentId, contentKind: "main", sourceUrl: "",
    localPath: "", contentSha1: "", byteSize: Buffer.byteLength(rawText), fetchedAt: "", } }).fragments;
}
