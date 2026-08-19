import assert from "node:assert/strict";
import test from "node:test";
import { CharacterContextBuilder } from "./context-builder.js";
import { CharacterMemoryService } from "./memory-service.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

test("memory consolidation keeps factual anchors separate from a character interpretation", () => {
  const repository = new SqliteCifRepository();
  repository.saveEvidence({ id: "seen-promise", sessionId: "demo", characterId: "mash", kind: "observation", content: "The player said: I will not leave you behind.", sourceEventIds: ["event-promise"], reliability: 1, importance: 0.9, occurredAt: "2026-08-12T20:00:00Z" });
  const memories = new CharacterMemoryService(repository);
  const episode = memories.consolidate({
    sessionId: "demo", characterId: "mash", sourceEvidenceIds: ["seen-promise"],
    summary: "After the battle, the player promised not to leave Mash behind.",
    subjectiveInterpretation: "Mash felt the player might be willing to share the burden.",
    emotions: [{ type: "relief", intensity: 0.7, targetId: "player" }], participantIds: ["player", "mash"],
    locationId: "courtyard", salience: 0.8, occurredAt: "2026-08-12T20:05:00Z",
  });
  assert.deepEqual(episode.sourceEventIds, ["event-promise"]);
  assert.equal(repository.listMemoryAtoms("demo", "mash")[0]?.content, "The player said: I will not leave you behind.");
  assert.equal(repository.listEpisodeMemories("demo", "mash")[0]?.subjectiveInterpretation, "Mash felt the player might be willing to share the burden.");
  assert.throws(() => memories.consolidate({ sessionId: "demo", characterId: "rin", sourceEvidenceIds: ["seen-promise"], salience: 0.5, occurredAt: "2026-08-12T20:05:00Z" }), /memory_sources_not_visible_to_character/);
  repository.close();
});

test("memory recall favors the current participant and carries only the owner memories into context", () => {
  const repository = new SqliteCifRepository();
  repository.saveEvidence({ id: "e-1", sessionId: "demo", characterId: "mash", kind: "observation", content: "The player was injured in battle.", sourceEventIds: ["event-1"], reliability: 1, importance: 0.8, occurredAt: "2026-08-12T20:00:00Z" });
  const memories = new CharacterMemoryService(repository);
  memories.consolidate({ sessionId: "demo", characterId: "mash", sourceEvidenceIds: ["e-1"], summary: "Mash saw the player injured after battle.", participantIds: ["player", "mash"], locationId: "courtyard", salience: 0.9, occurredAt: "2026-08-12T20:05:00Z" });
  const recalled = memories.recall("demo", "mash", { query: "player battle", participantIds: ["player"] });
  assert.equal(recalled.episodes[0]?.summary, "Mash saw the player injured after battle.");
  const context = new CharacterContextBuilder(repository).build("demo", "mash", { memoryQuery: { participantIds: ["player"] } });
  assert.equal(context.episodeMemories.length, 1);
  assert.equal(new CharacterContextBuilder(repository).build("demo", "rin").episodeMemories.length, 0);
  repository.close();
});
