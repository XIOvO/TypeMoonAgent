import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const sourceRoot = resolve("src");
const allowedDependencies = {
  agent: ["agent", "core", "protocol"],
  agents: ["agent", "agents", "cif", "core", "protocol"],
  api: ["api", "cif", "core", "narrative", "protocol"],
  app: ["agents", "api", "app", "cif", "core", "lore", "narrative", "persistence", "platform", "plugins.feature", "plugins.system", "protocol", "story"],
  cif: ["cif", "core", "lore", "protocol"],
  config: ["config", "platform", "protocol"],
  core: ["core", "kernel", "persistence", "protocol"],
  kernel: ["kernel", "protocol"],
  lore: ["lore", "protocol"],
  narrative: ["core", "narrative", "protocol"],
  observability: ["observability", "protocol"],
  persistence: ["cif", "core", "persistence", "protocol"],
  platform: ["platform", "protocol"],
  /** Stable package facade; it may re-export designated public modules only. */
  public: ["agent", "agents", "api", "cif", "config", "core", "lore", "narrative", "persistence", "platform", "plugins.feature", "plugins.system", "protocol", "story"],
  "plugins.feature": ["cif", "core", "platform", "plugins.feature", "protocol", "story"],
  "plugins.system": ["cif", "core", "persistence", "platform", "plugins.system", "protocol"],
  protocol: ["protocol"],
  story: ["cif", "core", "protocol", "story"],
};
const sqliteCifForbiddenModules = new Set(["agent", "agents", "plugins.feature"]);

const files = await findSourceFiles(sourceRoot);
const violations = [];
for (const file of files) {
  if (file.endsWith(".test.ts")) continue;
  const projectPath = relative(sourceRoot, file);
  const module = moduleForPath(projectPath);
  if (projectPath === "index.ts") continue;
  if (!allowedDependencies[module]) {
    violations.push(`${projectPath}: production file must belong to a registered module`);
    continue;
  }
  const content = await readFile(file, "utf8");
  for (const match of content.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) continue;
    const target = relative(sourceRoot, resolve(dirname(file), specifier));
    const targetModule = moduleForPath(target);
    if (sqliteCifForbiddenModules.has(module) && normalizedPath(target) === "cif/sqlite-repository") {
      violations.push(`${projectPath}: ${module} must depend on a CIF port, not SqliteCifRepository (${specifier})`);
    }
    if (projectPath === "core/runtime.ts" && normalizedPath(target) === "core/interaction-coordinator") {
      violations.push(`${projectPath}: Runtime must use InteractionCommandHandler, not the concrete interaction coordinator (${specifier})`);
    }
    if (targetModule && !allowedDependencies[module].includes(targetModule)) {
      violations.push(`${projectPath}: ${module} must not import ${targetModule} (${specifier})`);
    }
  }
}

if (violations.length > 0) {
  console.error("Module-boundary check failed:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Module-boundary check passed (${files.length} TypeScript files scanned).`);
}

async function findSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) return findSourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  }));
  return files.flat();
}

function moduleForPath(projectPath) {
  const [root, kind] = projectPath.split(sep);
  if (root === "public.ts") return "public";
  return root === "plugins" && kind ? `plugins.${kind}` : root;
}

function normalizedPath(projectPath) {
  return projectPath.split(sep).join("/").replace(/\.(?:js|ts)$/, "");
}
