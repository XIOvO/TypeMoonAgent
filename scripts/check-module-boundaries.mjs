import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const sourceRoot = resolve("src");
const allowedDependencies = {
  agents: ["agents", "cif", "core"],
  api: ["api", "cif", "core", "narrative"],
  app: ["agents", "api", "app", "cif", "core", "lore", "narrative", "persistence", "platform", "plugins", "story"],
  cif: ["cif", "core", "lore"],
  core: ["core", "persistence"],
  lore: ["lore"],
  narrative: ["core", "narrative"],
  platform: ["platform"],
  plugins: ["cif", "core", "persistence", "platform", "plugins", "story"],
  persistence: ["cif", "core", "persistence"],
  story: ["cif", "core", "story"],
};

const files = await findSourceFiles(sourceRoot);
const violations = [];
for (const file of files) {
  if (file.endsWith(".test.ts")) continue;
  const projectPath = relative(sourceRoot, file);
  const [module] = projectPath.split(sep);
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
    const [targetModule] = target.split(sep);
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
