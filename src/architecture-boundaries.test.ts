import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("module boundary checker deterministically rejects reverse-layer imports", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "agent-game-boundaries-"));
  try {
    await writeFixture(fixture, "protocol/invalid.ts", 'import {} from "../core/runtime.js";');
    await writeFixture(fixture, "kernel/invalid.ts", 'import {} from "../core/runtime.js";');
    await writeFixture(fixture, "plugins/feature/invalid.ts", 'import {} from "../system/persistence.js";');
    await writeFixture(fixture, "persistence/invalid.ts", 'import {} from "../plugins/feature/world-simulation.js";');
    await writeFixture(fixture, "sdk/invalid.ts", 'import {} from "../platform/cordis-platform.js";');

    const result = spawnSync(process.execPath, [resolve(process.cwd(), "scripts/check-module-boundaries.mjs"), fixture], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /protocol.*must not import core/);
    assert.match(result.stderr, /kernel.*must not import core/);
    assert.match(result.stderr, /plugins\.feature.*must not import plugins\.system/);
    assert.match(result.stderr, /persistence.*must not import plugins\.feature/);
    assert.match(result.stderr, /sdk must depend on public contracts, not private implementations/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

async function writeFixture(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, content);
}
