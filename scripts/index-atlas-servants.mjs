import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importAtlasServantProfiles } from "../dist/lore/atlas-servant-importer.js";
import { SqliteLoreRepository } from "../dist/lore/sqlite-repository.js";

const region = process.env.ATLAS_REGION ?? "CN";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "atlas", region, "servants");
const repository = new SqliteLoreRepository(process.env.LORE_DB_PATH ?? "lore.sqlite");
try { console.log(JSON.stringify(await importAtlasServantProfiles({ repository, sourceRoot: root, manifestPath: join(root, "manifest.json") }), null, 2)); }
finally { repository.close(); }
