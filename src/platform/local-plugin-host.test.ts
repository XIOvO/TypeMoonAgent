import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { LocalPluginHost } from "./local-plugin-host.js";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agent-game-plugin-host-"));
}

const manifest = {
  id: "feature.example",
  version: "1.0.0",
  apiVersion: "0.3.0",
  configVersion: 1,
  type: "feature",
};

test("local plugin host discovers only direct manifests below trusted roots", async () => {
  const root = await temporaryDirectory();
  const outside = await temporaryDirectory();
  try {
    const pluginPath = join(root, "example");
    await mkdir(pluginPath);
    await writeFile(join(pluginPath, "plugin.json"), JSON.stringify(manifest));
    await mkdir(join(outside, "not-discovered"));
    await writeFile(join(outside, "not-discovered", "plugin.json"), JSON.stringify(manifest));

    const plugins = await new LocalPluginHost({ trustedRoots: [root] }).discover();
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0]?.manifest.id, "feature.example");
    assert.equal(plugins[0]?.rootPath, await import("node:fs/promises").then(({ realpath }) => realpath(root)));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("local plugin host rejects manifest symlinks that escape a trusted root", async (context) => {
  const root = await temporaryDirectory();
  const outside = await temporaryDirectory();
  try {
    const pluginPath = join(root, "escaped");
    await mkdir(pluginPath);
    const outsideManifest = join(outside, "plugin.json");
    await writeFile(outsideManifest, JSON.stringify(manifest));
    try {
      await symlink(outsideManifest, join(pluginPath, "plugin.json"));
    } catch {
      context.skip("symbolic links are unavailable in this environment");
      return;
    }
    await assert.rejects(new LocalPluginHost({ trustedRoots: [root] }).discover(), /local_plugin_path_untrusted/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("local plugin host rejects non-absolute roots and malformed manifests", async () => {
  assert.throws(() => new LocalPluginHost({ trustedRoots: ["plugins"] }), /local_plugin_root_must_be_absolute/);
  const root = await temporaryDirectory();
  try {
    const pluginPath = join(root, "broken");
    await mkdir(pluginPath);
    await writeFile(join(pluginPath, "plugin.json"), "not json");
    await assert.rejects(new LocalPluginHost({ trustedRoots: [root] }).discover(), /local_plugin_manifest_invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
