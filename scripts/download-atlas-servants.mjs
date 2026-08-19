import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const region = process.argv.find((value) => value.startsWith("--region="))?.slice(9) ?? "CN";
const refresh = process.argv.includes("--refresh");
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "atlas", region, "servants");
const filename = "nice_servant_lore.json"; const localPath = join(root, filename);
const sourceUrl = `https://api.atlasacademy.io/export/${region}/${filename}`;
const sha1 = (content) => createHash("sha1").update(content).digest("hex");
await mkdir(root, { recursive: true });
let content;
if (!refresh) { try { content = await readFile(localPath); } catch (error) { if (error?.code !== "ENOENT") throw error; } }
if (!content) {
  const response = await fetch(sourceUrl); if (!response.ok) throw new Error(`Servant profile download failed (${response.status}): ${sourceUrl}`);
  content = Buffer.from(await response.arrayBuffer()); await writeFile(localPath, content);
}
const manifest = { schemaVersion: 1, source: "Atlas Academy FGO Game Data API", region, sourceUrl, localPath: filename,
  fetchedAt: new Date().toISOString(), contentSha1: sha1(content), bytes: content.length };
await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ stage: "complete", region, cached: await stat(localPath).then(() => true), bytes: content.length, manifest: join(root, "manifest.json") }, null, 2));
