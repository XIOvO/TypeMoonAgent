import { randomUUID } from "node:crypto";
import type { CifInitializationDraftRecord } from "./initializer.js";
import { validateCifInitializationDraft } from "./initializer.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

/**
 * The only bridge from a reviewed initialization draft into the live CIF
 * tables. It deliberately does not change GameState; Runtime decides when the
 * new character becomes visible in a scene.
 */
export class CifInitializationPublisher {
  public constructor(private readonly repository: SqliteCifRepository) {}

  public publish(record: CifInitializationDraftRecord, publishedAt = new Date().toISOString()): void {
    const stored = this.repository.getInitializationDraft(record.id);
    if (!stored || stored.status !== "approved") throw new Error("draft_must_be_approved_before_publish");
    if (stored.validationErrors.length || validateCifInitializationDraft(stored.brief, stored.draft).length) {
      throw new Error("draft_validation_failed");
    }
    const { request } = stored.brief;
    this.repository.transaction(() => {
      this.repository.saveProfile({
        sessionId: request.sessionId, characterId: request.characterId, variantId: request.variantId,
        storyPointId: request.storyPointId, displayName: request.displayName, aliases: request.aliases ?? [],
        ...stored.draft.profile, sourceIds: stored.draft.profile.sourceChunkIds, version: 1,
      });
      for (const item of stored.draft.capabilities) this.repository.saveCapability({
        id: randomUUID(), sessionId: request.sessionId, characterId: request.characterId, category: item.category,
        content: item.content, mechanicalTags: item.mechanicalTags, sourceIds: item.sourceChunkIds, version: 1,
      });
      this.repository.saveLifeContext({
        sessionId: request.sessionId, characterId: request.characterId, ...stored.draft.lifeContext,
        sourceIds: stored.draft.lifeContext.sourceChunkIds, version: 1,
      });
      for (const item of stored.draft.objectiveRelationships) this.repository.saveObjectiveRelationship({
        id: randomUUID(), sessionId: request.sessionId, characterId: request.characterId, targetId: item.targetId,
        relationType: item.relationType, sharedHistorySummary: item.sharedHistorySummary,
        currentObjectiveStatus: item.currentObjectiveStatus, sourceIds: item.sourceChunkIds, version: 1,
      });
      const existing = this.repository.listIdentity(request.sessionId, request.characterId);
      for (const item of stored.draft.identity) {
        const version = Math.max(0, ...existing.filter((model) => model.section === item.section).map((model) => model.version)) + 1;
        this.repository.saveIdentity({
          id: randomUUID(), sessionId: request.sessionId, characterId: request.characterId, section: item.section,
          content: item.content, sourceIds: item.sourceChunkIds, version,
        });
      }
      for (const item of stored.draft.initialKnowledge) {
        this.repository.saveEpistemicState({
          id: randomUUID(), sessionId: request.sessionId, characterId: request.characterId, proposition: item.proposition,
          status: item.confidence === "high" ? "accepted" : "likely", confidence: confidenceValue(item.confidence),
          supportingEvidenceIds: item.sourceChunkIds, opposingEvidenceIds: [], version: 1,
        });
      }
      for (const item of stored.draft.initialRelationships) {
        this.repository.saveInterpretiveModel({
          id: randomUUID(), sessionId: request.sessionId, characterId: request.characterId, kind: "social", targetId: item.targetId,
          content: item.summary, activation: confidenceValue(item.confidence), supportingEvidenceIds: item.sourceChunkIds,
          opposingEvidenceIds: [], version: 1,
        });
      }
      this.repository.saveRuntimeState({
        sessionId: request.sessionId, characterId: request.characterId, attention: request.introduction.presentEntityIds,
        emotions: [], activeGoals: stored.draft.initialRuntimeState.activeGoals, locationId: request.introduction.locationId,
        availability: "free", updatedAt: publishedAt,
      });
      this.repository.saveAppearanceFactors({
        sessionId: request.sessionId, characterId: request.characterId,
        activeGoals: stored.draft.initialRuntimeState.activeGoals,
        responseWeights: {}, relationshipWeights: {}, availability: "free", updatedAt: publishedAt,
      });
      this.repository.appendObjectiveHistory({
        id: `character_profile_published:${stored.id}`, sessionId: request.sessionId, sequence: this.repository.nextObjectiveSequence(request.sessionId),
        eventType: "character_profile_published", payload: {
          characterId: request.characterId, variantId: request.variantId, storyPointId: request.storyPointId,
          locationId: request.introduction.locationId, sourceDraftId: stored.id,
        }, createdAt: publishedAt,
      });
      this.repository.publishInitializationDraft(stored.id, publishedAt);
    });
  }
}

function confidenceValue(value: "high" | "medium" | "low"): number {
  return value === "high" ? 0.9 : value === "medium" ? 0.65 : 0.4;
}
