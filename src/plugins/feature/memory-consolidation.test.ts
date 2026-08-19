import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../../cif/sqlite-repository.js";
import type { CommandGateway } from "../../core/command-gateway.js";
import type { CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import type { GameComposition } from "../../platform/contracts.js";
import { SqliteDurableJobQueue } from "../system/durable-jobs.js";
import { WORLD_MEMORY_CONSOLIDATION_CAPABILITY, createMemoryConsolidationPlugin, type MemoryConsolidationController } from "./memory-consolidation.js";

test("feature memory-consolidation drains L1 work and unsubscribes on disposal", async () => {
  const repository = new SqliteCifRepository();
  const jobs = new SqliteDurableJobQueue(repository);
  const listeners = new Set<() => void>();
  const commands = { subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); } } as unknown as CommandGateway;
  const feature = createMemoryConsolidationPlugin({
    sessionId: "demo", jobs, store: repository, commands, intervalMs: 1_000,
    generator: { async generate() { return { shouldRemember: true, summary: "Mash remembers the promise.", salience: 0.8 }; } },
  });
  const composition: GameComposition = {
    profileId: "memory-consolidation-test",
    plugins: [
      { plugin: provider("system.test-jobs", "world.jobs", "worldJobs") },
      { plugin: provider("system.test-command", "world.commandGateway", "worldCommandGateway") },
      { plugin: feature },
    ],
  };
  const running = await bootstrap(new CordisPlatformAdapter(), composition);
  const controller = running.get<MemoryConsolidationController>(WORLD_MEMORY_CONSOLIDATION_CAPABILITY);
  addJob(repository, "first");
  assert.equal(await controller.drain("demo"), 1);
  assert.equal(repository.listEpisodeMemories("demo", "mash").length, 1);

  await running.dispose();
  addJob(repository, "after-dispose");
  for (const listener of listeners) listener();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(repository.listEpisodeMemories("demo", "mash").length, 1);
  repository.close();
});

function provider(id: string, capability: string, serviceKey: string): CordisGamePluginDefinition {
  return { manifest: { id, version: "1.0.0", configVersion: 1, provides: [{ id: capability, serviceKey }] }, implementation: () => undefined };
}

function addJob(repository: SqliteCifRepository, id: string): void {
  repository.saveEvidence({ id: `e-${id}`, sessionId: "demo", characterId: "mash", kind: "observation", content: "The player made a promise.", sourceEventIds: [`event-${id}`], reliability: 1, importance: 0.8, occurredAt: "2000-01-01T00:00:00.000Z" });
  repository.enqueueDurableJob({ id: `job-${id}`, sessionId: "demo", kind: "memory.l1", dedupeKey: `test:${id}`, payload: { characterId: "mash", trigger: "important_dialogue", sourceEvidenceIds: [`e-${id}`], participantIds: ["mash", "player"] }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: "2000-01-01T00:00:00.000Z", createdAt: "2000-01-01T00:00:00.000Z" });
}
