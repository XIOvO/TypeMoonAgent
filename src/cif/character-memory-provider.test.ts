import assert from "node:assert/strict";
import test from "node:test";
import { ServiceCharacterMemoryProvider } from "./character-memory-provider.js";
import { CharacterMemoryService } from "./memory-service.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

test("CharacterMemoryProvider recalls only the requested character's memory", async () => {
  const repository = new SqliteCifRepository();
  repository.saveMemoryAtom({ id: "mash:atom", sessionId: "demo", ownerId: "mash", content: "Mash remembers the bridge.", kind: "observed_fact", sourceEventIds: ["event:1"], participantIds: ["mash"], confidence: 1, importance: 1, occurredAt: "2026-08-20T00:00:00.000Z" });
  repository.saveMemoryAtom({ id: "rin:atom", sessionId: "demo", ownerId: "rin", content: "Rin remembers the workshop.", kind: "observed_fact", sourceEventIds: ["event:2"], participantIds: ["rin"], confidence: 1, importance: 1, occurredAt: "2026-08-20T00:00:00.000Z" });
  const provider = new ServiceCharacterMemoryProvider(new CharacterMemoryService(repository));

  const mash = await provider.recall({ sessionId: "demo", characterId: "mash", limits: { atoms: 1, episodes: 0 } });
  const rin = await provider.recall({ sessionId: "demo", characterId: "rin", limits: { atoms: 1, episodes: 0 } });
  assert.deepEqual(mash.atoms.map(({ id }) => id), ["mash:atom"]);
  assert.deepEqual(rin.atoms.map(({ id }) => id), ["rin:atom"]);
  repository.close();
});
