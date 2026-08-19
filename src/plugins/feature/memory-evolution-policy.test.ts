import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../../cif/sqlite-repository.js";
import type { CommandGateway } from "../../core/command-gateway.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter, type CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import type { GameComposition } from "../../platform/contracts.js";
import { SqliteDurableJobQueue } from "../system/durable-jobs.js";
import { WORLD_MEMORY_EVOLUTION_POLICY_CAPABILITY, createMemoryEvolutionPolicyPlugin, type MemoryEvolutionPolicyController } from "./memory-evolution-policy.js";

test("memory evolution policy schedules one deduplicated L2 candidate only after a second L1 memory", async () => {
  const repository = new SqliteCifRepository();
  const jobs = new SqliteDurableJobQueue(repository);
  addEpisode(repository, "one", "2026-08-01T00:00:00.000Z");
  const commands = { subscribe() { return () => undefined; } } as unknown as CommandGateway;
  const feature = createMemoryEvolutionPolicyPlugin({ sessionId: "demo", jobs, store: repository, commands, characterIds: () => ["mash"], intervalMs: 1_000 });
  const composition: GameComposition = { profileId: "memory-policy-test", plugins: [
    { plugin: provider("system.test-jobs", "world.jobs", "worldJobs") },
    { plugin: provider("system.test-command", "world.commandGateway", "worldCommandGateway") },
    { plugin: provider("feature.test-patterns", "world.cifPatterns", "worldCifPatterns") },
    { plugin: feature },
  ] };
  const running = await bootstrap(new CordisPlatformAdapter(), composition);
  const policy = running.get<MemoryEvolutionPolicyController>(WORLD_MEMORY_EVOLUTION_POLICY_CAPABILITY);
  policy.evaluate("demo");
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "memory.l2", now: "2030-01-01T00:00:00.000Z", leaseExpiresBefore: "2029-12-31T23:55:00.000Z" }), undefined);
  addEpisode(repository, "two", "2026-08-02T00:00:00.000Z");
  policy.evaluate("demo");
  assert.equal(repository.claimDurableJob({ sessionId: "demo", workerId: "test", kind: "memory.l2", now: "2030-01-01T00:00:00.000Z", leaseExpiresBefore: "2029-12-31T23:55:00.000Z" })?.payload.triggerEpisodeId, "episode-two");
  await running.dispose();
  repository.close();
});

function provider(id: string, capability: string, serviceKey: string): CordisGamePluginDefinition { return { manifest: { id, version: "1.0.0", configVersion: 1, provides: [{ id: capability, serviceKey }] }, implementation: () => undefined }; }
function addEpisode(repository: SqliteCifRepository, id: string, occurredAt: string): void { repository.saveEpisodeMemory({ id: `episode-${id}`, sessionId: "demo", ownerId: "mash", sourceEventIds: [], factualAnchorIds: [], summary: id, emotions: [], participantIds: ["mash", "player"], salience: 0.8, status: "active", occurredAt }); }
