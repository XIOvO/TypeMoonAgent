import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const region = "CN";
const warId = 100;
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "atlas", region, `war-${warId}-fuyuki`);
const scriptsRoot = join(root, "scripts");
const manifestPath = join(root, "manifest.json");
const refresh = process.argv.includes("--refresh");

async function requestJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
  return response.json();
}

function sha1(content) {
  return createHash("sha1").update(content).digest("hex");
}

async function loadManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function main() {
  await mkdir(scriptsRoot, { recursive: true });
  const war = await requestJson(`https://api.atlasacademy.io/nice/${region}/war/${warId}`);
  const quests = war.spots.flatMap((spot) => spot.quests).filter((quest) => quest.type === "main");
  const prior = await loadManifest();
  const previousById = new Map((prior?.scripts ?? []).map((script) => [script.scriptId, script]));
  const discovered = [];

  for (const quest of quests) {
    const detail = await requestJson(`https://api.atlasacademy.io/nice/${region}/quest/${quest.id}`);
    for (const phase of detail.phaseScripts ?? []) {
      for (const script of phase.scripts ?? []) {
        discovered.push({
          scriptId: script.scriptId,
          url: script.script,
          questId: quest.id,
          questName: quest.name,
          phase: phase.phase,
        });
      }
    }
  }

  const uniqueScripts = [...new Map(discovered.map((script) => [script.scriptId, script])).values()];
  const completed = [];
  let downloaded = 0;
  for (const script of uniqueScripts) {
    const filename = `${script.scriptId}.txt`;
    const localPath = join(scriptsRoot, filename);
    const previous = previousById.get(script.scriptId);
    if (!refresh && previous?.contentSha1 && await fileExists(localPath)) {
      completed.push({ ...script, localPath: `scripts/${filename}`, ...previous, status: "cached" });
      continue;
    }
    const response = await fetch(script.url);
    if (!response.ok) throw new Error(`Script download failed (${response.status}): ${script.scriptId}`);
    const content = Buffer.from(await response.arrayBuffer());
    await writeFile(localPath, content);
    downloaded += 1;
    completed.push({
      ...script,
      localPath: `scripts/${filename}`,
      contentSha1: sha1(content),
      sourceSha1: response.headers.get("x-bz-content-sha1") ?? undefined,
      bytes: content.length,
      status: "downloaded",
    });
  }

  const manifest = {
    schemaVersion: 1,
    source: "Atlas Academy FGO Game Data API",
    region,
    war: { id: war.id, name: war.name, longName: war.longName },
    scope: "main quests only; excludes free and friendship quests",
    fetchedAt: new Date().toISOString(),
    scripts: completed,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const bytes = completed.reduce((total, script) => total + (script.bytes ?? 0), 0);
  console.log(JSON.stringify({ quests: quests.length, scripts: completed.length, downloaded, cached: completed.length - downloaded, bytes, manifest: manifestPath }, null, 2));
}

await main();
