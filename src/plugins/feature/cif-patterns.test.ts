import assert from "node:assert/strict";
import test from "node:test";
import { SqliteCifRepository } from "../../cif/sqlite-repository.js";
import { CifPatternPublisher } from "../../cif/pattern-publisher.js";
import type { CommandGateway } from "../../core/command-gateway.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter, type CordisGamePluginDefinition } from "../../platform/cordis-platform.js";
import type { GameComposition } from "../../platform/contracts.js";
import { SqliteDurableJobQueue } from "../system/durable-jobs.js";
import { WORLD_CIF_PATTERNS_CAPABILITY, createCifPatternsPlugin, type CifPatternsController } from "./cif-patterns.js";

test("feature cif-patterns writes only review drafts and stops waking after disposal", async () => {
  const repository = new SqliteCifRepository();
  const jobs = new SqliteDurableJobQueue(repository);
  addEpisode(repository, "one", "2026-08-01T00:00:00.000Z");
  addEpisode(repository, "two", "2026-08-02T00:00:00.000Z");
  const listeners = new Set<() => void>();
  const commands = { subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); } } as unknown as CommandGateway;
  const feature = createCifPatternsPlugin({ sessionId: "demo", jobs, store: repository, commands, intervalMs: 1_000, generator: { async generate() {
    return { shouldPropose: false, characterId: "mash", sourceEpisodeIds: ["episode-one", "episode-two"] };
  } }, auditor: { async audit() { return { layer: "l2", decision: "defer", risk: "low", citedInputIds: [], rationale: "No change requires no audit.", policyVersion: 1 }; } }, publisher: new CifPatternPublisher(repository) });
  const composition: GameComposition = { profileId: "cif-patterns-test", plugins: [
    { plugin: provider("system.test-jobs", "world.jobs", "worldJobs") },
    { plugin: provider("system.test-command", "world.commandGateway", "worldCommandGateway") },
    { plugin: feature },
  ] };
  const running = await bootstrap(new CordisPlatformAdapter(), composition);
  const controller = running.get<CifPatternsController>(WORLD_CIF_PATTERNS_CAPABILITY);
  enqueue(repository, "first");
  assert.equal(await controller.drain("demo"), 1);
  assert.equal(repository.listPatternDrafts("demo", "mash").length, 1);
  assert.equal(repository.listInterpretiveModels("demo", "mash", 5).length, 0);

  await running.dispose();
  enqueue(repository, "after-dispose");
  for (const listener of listeners) listener();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(repository.listPatternDrafts("demo", "mash").length, 1);
  repository.close();
});

function provider(id: string, capability: string, serviceKey: string): CordisGamePluginDefinition { return { manifest: { id, version: "1.0.0", configVersion: 1, provides: [{ id: capability, serviceKey }] }, implementation: () => undefined }; }
function addEpisode(repository: SqliteCifRepository, id: string, occurredAt: string): void { repository.saveEpisodeMemory({ id: `episode-${id}`, sessionId: "demo", ownerId: "mash", sourceEventIds: [], factualAnchorIds: [], summary: id, emotions: [], participantIds: ["mash"], salience: 0.8, status: "active", occurredAt }); }
function enqueue(repository: SqliteCifRepository, id: string): void { repository.enqueueDurableJob({ id: `job-${id}`, sessionId: "demo", kind: "memory.l2", dedupeKey: `mash:${id}`, payload: { characterId: "mash", triggerEpisodeId: "episode-two" }, status: "pending", attempts: 0, maxAttempts: 5, availableAt: "2000-01-01T00:00:00.000Z", createdAt: "2000-01-01T00:00:00.000Z" }); }
