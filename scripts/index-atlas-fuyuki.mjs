import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importAtlasManifest } from "../dist/lore/atlas-importer.js";
import { SqliteLoreRepository } from "../dist/lore/sqlite-repository.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "atlas", "CN", "war-100-fuyuki");
const databasePath = process.env.LORE_DB_PATH ?? "lore.sqlite";
const repository = new SqliteLoreRepository(databasePath);
try {
  const imported = await importAtlasManifest({ repository, sourceRoot: root, manifestPath: join(root, "manifest.json") });
  console.log(JSON.stringify({ databasePath, ...imported, indexedDocuments: repository.countDocuments(), indexedChunks: repository.countChunks() }, null, 2));
} finally {
  repository.close();
}
