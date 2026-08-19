import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SqliteLoreRepository } from "./sqlite-repository.js";
import type { CanonDocumentBundle, CanonServantProfileEntryInput, CanonServantProfileInput } from "./types.js";

interface AtlasProfileComment {
  id?: number; priority?: number; condMessage?: string; comment?: string;
  condType?: string; condValues?: number[]; condValue2?: number; additionalConds?: unknown[];
}

interface AtlasServant {
  id: number; collectionNo?: number; name: string; originalName?: string; className?: string;
  rarity?: number; gender?: string; attribute?: string;
  profile?: { cv?: string; illustrator?: string; stats?: Record<string, unknown>; comments?: AtlasProfileComment[] };
}

export interface AtlasServantManifest {
  region: string; fetchedAt: string; sourceUrl: string; localPath: string; contentSha1: string; bytes: number;
}

const sha1 = (value: unknown): string => createHash("sha1").update(JSON.stringify(value)).digest("hex");
const profileId = (region: string, servantId: number) => `atlas:${region}:servant:${servantId}`;
const clean = (text: string): string => text.replace(/\[r\]/g, "\n").replace(/\[[^\]]*\]/g, "").replace(/\s*\n\s*/g, "\n").trim();
const condition = (comment: AtlasProfileComment): Record<string, unknown> => ({
  type: comment.condType ?? "none", values: comment.condValues ?? [], value2: comment.condValue2 ?? 0,
  message: comment.condMessage ?? "", additional: comment.additionalConds ?? [],
});

/** Turns one official Servant Profile into source-linked fragments and structured unlockable entries. */
export function buildServantProfileBundle(input: { region: string; sourceUrl: string; localPath: string; fetchedAt: string; contentSha1: string; servant: AtlasServant }): {
  bundle: CanonDocumentBundle; profile: CanonServantProfileInput; entries: CanonServantProfileEntryInput[];
} {
  const { region, servant } = input; const id = profileId(region, servant.id); const documentId = `${id}:document`;
  const source = { id: servant.id, collectionNo: servant.collectionNo, name: servant.name, originalName: servant.originalName,
    className: servant.className, rarity: servant.rarity, gender: servant.gender, attribute: servant.attribute, profile: servant.profile ?? {} };
  const contentSha1 = sha1(source);
  const comments = (servant.profile?.comments ?? []).map((comment) => ({ ...comment, text: clean(comment.comment ?? "") })).filter((comment) => comment.text);
  const entries = comments.map((comment, index): CanonServantProfileEntryInput => ({
    id: `${id}:entry:${String(index + 1).padStart(3, "0")}`, profileId: id, entryOrder: index + 1,
    sourceEntryId: comment.id, priority: comment.priority ?? 0, unlockCondition: condition(comment), text: comment.text,
  }));
  const overview = [
    `从者：${servant.name}`, servant.originalName ? `原名：${servant.originalName}` : "", servant.className ? `职阶：${servant.className}` : "",
    servant.rarity !== undefined ? `稀有度：${servant.rarity}` : "", servant.gender ? `性别：${servant.gender}` : "", servant.attribute ? `属性：${servant.attribute}` : "",
    servant.profile?.cv ? `CV：${servant.profile.cv}` : "", servant.profile?.illustrator ? `画师：${servant.profile.illustrator}` : "",
  ].filter(Boolean).join("\n");
  const fragments = [
    { id: `${documentId}:fragment:000`, documentId, fragmentOrder: 0, text: overview, speakerNames: [servant.name], dialogueIds: [], spoilerUnlockKey: `${id}:base` },
    ...entries.map((entry) => ({ id: `${documentId}:fragment:${String(entry.entryOrder).padStart(3, "0")}`, documentId, fragmentOrder: entry.entryOrder,
      text: entry.text, speakerNames: [servant.name], dialogueIds: [], spoilerUnlockKey: `${id}:entry:${entry.entryOrder}` })),
  ];
  return {
    bundle: { document: { id: documentId, source: "atlas", region, scriptId: `servant:${servant.id}`, contentKind: "servant_profile",
      sourceUrl: `${input.sourceUrl}#${servant.id}`, localPath: input.localPath, contentSha1, sourceSha1: input.contentSha1,
      byteSize: Buffer.byteLength(JSON.stringify(source)), fetchedAt: input.fetchedAt }, scenes: [], fragments },
    profile: { id, documentId, region, atlasServantId: servant.id, collectionNo: servant.collectionNo, displayName: servant.name,
      originalName: servant.originalName, className: servant.className, rarity: servant.rarity, gender: servant.gender, attribute: servant.attribute,
      cv: servant.profile?.cv, illustrator: servant.profile?.illustrator, parameters: servant.profile?.stats ?? {}, profileJson: source.profile },
    entries,
  };
}

export async function importAtlasServantProfiles(input: { repository: SqliteLoreRepository; manifestPath: string; sourceRoot: string }): Promise<{ imported: number; profiles: number; entries: number }> {
  const manifest = JSON.parse(await readFile(input.manifestPath, "utf8")) as AtlasServantManifest;
  const servants = JSON.parse(await readFile(`${input.sourceRoot}/${manifest.localPath}`, "utf8")) as AtlasServant[];
  let imported = 0; let entries = 0;
  for (const servant of servants.filter((candidate) => (candidate.collectionNo ?? 0) > 0)) {
    const built = buildServantProfileBundle({ ...manifest, servant });
    if (!input.repository.hasDocumentContent(built.bundle.document.id, built.bundle.document.contentSha1)) input.repository.replaceDocument(built.bundle);
    input.repository.replaceServantProfile(built.profile, built.entries);
    imported += 1; entries += built.entries.length;
    if (imported % 100 === 0) console.log(JSON.stringify({ stage: "servant_profiles", imported, entries }));
  }
  return { imported, profiles: input.repository.countServantProfiles(), entries };
}
