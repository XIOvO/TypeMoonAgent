import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argument = (name, fallback) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const region = argument("--region", "CN");
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "atlas", region, "canon");
const scriptsRoot = join(root, "scripts");
const manifestPath = join(root, "manifest.json");
const curatedEventPath = join(dirname(fileURLToPath(import.meta.url)), "..", "config", `atlas-curated-events.${region}.json`);
const refresh = process.argv.includes("--refresh");
const concurrency = Math.max(1, Number(argument("--concurrency", "6")) || 6);
const exportApi = `https://api.atlasacademy.io/export/${region}`;

const sha1 = (content) => createHash("sha1").update(content).digest("hex");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function requestJson(url) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    if (response.status < 500 && response.status !== 429) throw new Error(`Request failed (${response.status}): ${url}`);
    await sleep(500 * (attempt + 1));
  }
  throw new Error(`Request repeatedly failed: ${url}`);
}
async function loadJson(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error?.code === "ENOENT") return undefined; throw error; } }
async function fileExists(path) { try { return (await stat(path)).isFile(); } catch (error) { if (error?.code === "ENOENT") return false; throw error; } }
async function mapPool(values, mapper) {
  const output = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) { const index = cursor++; output[index] = await mapper(values[index], index); }
  }));
  return output;
}
function contentKind(war, quest) { if (quest.type === "friendship") return "interlude"; return war.eventId ? "event" : "main"; }
function includeQuest(war, quest, curatedEventWarIds) {
  if (quest.type === "friendship") return true;
  if (!war.eventId) return quest.type === "main";
  return curatedEventWarIds.has(war.id);
}

async function main() {
  await mkdir(scriptsRoot, { recursive: true });
  const curatedEventWarIds = new Set((await loadJson(curatedEventPath))?.warIds ?? []);
  const prior = await loadJson(manifestPath);
  const priorById = new Map((prior?.scripts ?? []).map((script) => [script.scriptId, script]));
  // nice_war already contains spots, quests, phase scripts and Script URLs. One export avoids thousands of detail calls.
  const wars = await requestJson(`${exportApi}/nice_war.json`);
  const candidates = wars.flatMap((war) => war.spots.flatMap((spot) => spot.quests
    .filter((quest) => includeQuest(war, quest, curatedEventWarIds))
    .map((quest) => ({ war, spot, quest }))));
  console.log(JSON.stringify({ stage: "quests_discovered", wars: wars.length, candidateQuests: candidates.length, curatedEventWars: curatedEventWarIds.size }, null, 2));
  const discovered = candidates.flatMap(({ war, spot, quest }) => (quest.phaseScripts ?? []).flatMap((phase) => (phase.scripts ?? []).map((script) => ({
    scriptId: script.scriptId, url: script.script, warId: war.id, warName: war.name, warLongName: war.longName,
    eventId: war.eventId || undefined, spotId: spot.id, spotName: spot.name, mapId: spot.mapId, questId: quest.id,
    questName: quest.name, questType: quest.type, chapterId: quest.chapterId || undefined, chapterSubId: quest.chapterSubId || undefined,
    chapterSubStr: quest.chapterSubStr || undefined, phase: phase.phase, contentKind: contentKind(war, quest),
  }))));
  const uniqueScripts = [...new Map(discovered.map((script) => [script.scriptId, script])).values()];
  console.log(JSON.stringify({ stage: "scripts_discovered", scripts: uniqueScripts.length }, null, 2));
  let downloaded = 0; let cached = 0;
  const scripts = await mapPool(uniqueScripts, async (script) => {
    const filename = `${script.scriptId}.txt`; const localPath = join(scriptsRoot, filename); const previous = priorById.get(script.scriptId);
    if (!refresh && await fileExists(localPath)) {
      const content = await readFile(localPath); cached += 1;
      return { ...script, localPath: `scripts/${filename}`, contentSha1: previous?.contentSha1 ?? sha1(content),
        sourceSha1: previous?.sourceSha1, bytes: content.length, status: "cached" };
    }
    const response = await fetch(script.url);
    if (!response.ok) throw new Error(`Script download failed (${response.status}): ${script.scriptId}`);
    const content = Buffer.from(await response.arrayBuffer()); await writeFile(localPath, content); downloaded += 1;
    return { ...script, localPath: `scripts/${filename}`, contentSha1: sha1(content), sourceSha1: response.headers.get("x-bz-content-sha1") ?? undefined,
      bytes: content.length, status: "downloaded" };
  });
  const manifest = { schemaVersion: 2, source: "Atlas Academy FGO Game Data API", region, scope: "main and interlude quests plus explicitly curated event wars with Atlas phase scripts",
    fetchedAt: new Date().toISOString(), wars: wars.map((war) => ({ id: war.id, name: war.name, longName: war.longName, eventId: war.eventId || undefined })), scripts };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const bytes = scripts.reduce((total, script) => total + (script.bytes ?? 0), 0);
  console.log(JSON.stringify({ stage: "complete", region, wars: wars.length, scripts: scripts.length, downloaded, cached, bytes, manifest: manifestPath }, null, 2));
}

await main();
