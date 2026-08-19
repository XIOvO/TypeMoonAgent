import assert from "node:assert/strict";
import test from "node:test";
import { SqliteLoreRepository } from "../lore/sqlite-repository.js";
import { buildCifInitializationPrompt, CifInitializer, validateCifInitializationDraft } from "./initializer.js";
import { buildCifL3RevisionPrompt } from "./prompts.js";
import { validateCifL3RevisionProposal } from "./revision.js";
import { IDENTITY_SECTIONS } from "./types.js";

test("CIF initializer retrieves only in-scope canon evidence and requires citations", () => {
  const lore = new SqliteLoreRepository();
  lore.upsertCollection({ id: "atlas:CN:war:100", region: "CN", atlasWarId: 100, contentKind: "main", name: "冬木" });
  const add = (id: string, questId: number, text: string) => {
    const nodeId = `atlas:CN:quest:${questId}`; const phaseId = `${nodeId}:phase:1`;
    lore.upsertStoryNode({ id: nodeId, collectionId: "atlas:CN:war:100", atlasQuestId: questId, name: "冬木", questType: "main", contentKind: "main", unlockKey: phaseId });
    lore.upsertPhase({ id: phaseId, storyNodeId: nodeId, phase: 1, scriptIds: [id] });
    lore.replaceDocument({ document: {
      id, source: "atlas", region: "CN", scriptId: id.slice(-1), storyNodeId: nodeId, phaseId, contentKind: "main",
      sourceUrl: "https://example.test", localPath: "script.txt", contentSha1: id, byteSize: text.length, fetchedAt: "2026-08-12T00:00:00Z",
    }, scenes: [], fragments: [{ id: `${id}:fragment:0001`, documentId: id, fragmentOrder: 1, text, speakerNames: ["玛修"], dialogueIds: [], spoilerUnlockKey: phaseId }] });
  };
  add("atlas:CN:script:early", 1000000, "玛修提醒前辈不要离开她身边。");
  add("atlas:CN:script:future", 1000010, "玛修在未来事件中得知了不应提前知道的事实。");
  const initializer = new CifInitializer(lore);
  const brief = initializer.buildBrief({
    sessionId: "demo", characterId: "mash", displayName: "玛修", variantId: "fgo-early", storyPointId: "fuyuki:start",
    introduction: { locationId: "fuyuki", presentEntityIds: ["player"], reason: "story_trigger" },
    canonScope: { region: "CN", warId: 100, maxQuestId: 1000000 },
  });
  assert.equal(brief.evidence.length, 1);
  assert.match(brief.evidence[0]?.excerpt ?? "", /不要离开/);
  assert.match(buildCifInitializationPrompt(brief), /Do not invent/);
  assert.deepEqual(validateCifInitializationDraft(brief, {
    characterId: "mash", variantId: "fgo-early", storyPointId: "fuyuki:start",
    identity: [{ section: "values", content: "protective", sourceChunkIds: [brief.evidence[0]!.chunkId], confidence: "medium" }],
    profile: { sourceChunkIds: [brief.evidence[0]!.chunkId] }, capabilities: [], lifeContext: { responsibilities: [], currentProblems: [], availableResources: [], missingResources: [], sourceChunkIds: [brief.evidence[0]!.chunkId] }, objectiveRelationships: [],
    initialKnowledge: [], initialRelationships: [], initialRuntimeState: { mood: "alert", activeGoals: ["protect player"] }, reviewFlags: [],
  }), []);
  lore.close();
});

test("initialization and L3 prompts map to validated CIF database fields", () => {
  assert.deepEqual(IDENTITY_SECTIONS, ["character_brief", "self_model", "core_schema", "needs", "values", "possible_self", "dream", "commitment", "appraisal_tendencies", "emotional_pattern", "practical_judgment", "expression_filter", "voice_embodiment", "growth_boundaries"]);
  const brief = { request: { sessionId: "demo", characterId: "mash", displayName: "玛修", variantId: "early", storyPointId: "start", introduction: { locationId: "hall", presentEntityIds: ["player"], reason: "story_trigger" as const }, canonScope: { region: "CN" } }, evidence: [{ chunkId: "c-1", scriptId: "s", chunkOrder: 1, excerpt: "玛修保护前辈。", matchedTerms: ["玛修"] }], gaps: [] };
  assert.deepEqual(validateCifInitializationDraft(brief, { characterId: "mash", variantId: "early", storyPointId: "start", identity: [{ section: "character_brief", content: "A guarded young demi-servant who protects the player.", sourceChunkIds: ["c-1"], confidence: "high" }, { section: "values", content: "Protect companions.", sourceChunkIds: ["c-1"], confidence: "high" }], profile: { socialIdentity: "Demi-Servant", sourceChunkIds: ["c-1"] }, capabilities: [], lifeContext: { responsibilities: [], currentProblems: [], availableResources: [], missingResources: [], sourceChunkIds: ["c-1"] }, objectiveRelationships: [{ targetId: "player", relationType: "mission_partner", sourceChunkIds: ["c-1"] }], initialKnowledge: [{ proposition: "The player is present.", sourceChunkIds: ["c-1"], confidence: "medium" }], initialRelationships: [{ targetId: "player", summary: "She treats the player as someone to protect.", sourceChunkIds: ["c-1"], confidence: "medium" }], initialRuntimeState: { mood: "alert", activeGoals: ["keep player safe"] }, reviewFlags: [] }), []);
  const l3 = { sessionId: "demo", characterId: "mash", triggerEpisodeId: "e-3", identity: [{ id: "i-1", sessionId: "demo", characterId: "mash", section: "practical_judgment" as const, content: "Protect companions.", sourceIds: ["c-1"], version: 1 }], epistemicStates: [], interpretiveModels: [], episodes: ["e-1", "e-2", "e-3"].map((id) => ({ id, sessionId: "demo", ownerId: "mash", sourceEventIds: [], factualAnchorIds: [], summary: "Repeated evidence.", emotions: [], participantIds: ["player"], salience: 0.7, status: "active" as const, occurredAt: "2026-08-14T00:00:00Z" })) };
  assert.deepEqual(validateCifL3RevisionProposal(l3, { characterId: "mash", revisions: [{ section: "practical_judgment", proposedContent: "Protect companions, while accepting help.", rationale: "Three independent episodes support a durable refinement.", sourceEpisodeIds: ["e-1", "e-2", "e-3"], confidence: "high" }], reviewFlags: [] }), []);
  assert.deepEqual(validateCifL3RevisionProposal(l3, { characterId: "mash", revisions: [{ section: "needs", proposedContent: "Unsupported.", rationale: "Only one scene.", sourceEpisodeIds: ["e-1"], confidence: "low" }], reviewFlags: [] }), ["revision_targets_missing_identity_section", "revision_section_not_auto_publishable", "revision_requires_high_confidence", "revision_requires_three_distinct_episodes", "revision_requires_trigger_episode"]);
  assert.match(buildCifL3RevisionPrompt(l3), /two distinct L1 episode IDs/);
});
