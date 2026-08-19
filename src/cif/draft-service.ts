import { randomUUID } from "node:crypto";
import type { CifDraftGenerator, CifInitializationBrief, CifInitializationDraft, CifInitializationDraftRecord } from "./initializer.js";
import { validateCifInitializationDraft } from "./initializer.js";
import { SqliteCifRepository } from "./sqlite-repository.js";
import { CifInitializationPublisher } from "./publisher.js";

/** Runs an initializer worker once, validates its output, then stores an unpublished audit draft. */
export class CifDraftService {
  public constructor(private readonly repository: SqliteCifRepository, private readonly generator: CifDraftGenerator, private readonly generatorName: string, private readonly publisher?: CifInitializationPublisher) {}

  public async create(brief: CifInitializationBrief): Promise<CifInitializationDraftRecord> {
    const draft = await this.generator.generate(brief);
    const validationErrors = validateCifInitializationDraft(brief, draft);
    const record: CifInitializationDraftRecord = {
      id: randomUUID(), status: validationErrors.length ? "invalid" : "draft", brief, draft, validationErrors,
      generator: this.generatorName, createdAt: new Date().toISOString(),
    };
    this.repository.saveInitializationDraft(record);
    if (!validationErrors.length && this.publisher && hasMinimumBaseline(draft)) {
      this.repository.setInitializationDraftStatus(record.id, "approved", new Date().toISOString());
      this.publisher.publish(record);
      return this.repository.getInitializationDraft(record.id)!;
    }
    return record;
  }
}

function hasMinimumBaseline(draft: CifInitializationDraft): boolean {
  const sections = new Set(draft.identity.map((item) => item.section));
  return draft.profile.sourceChunkIds.length > 0 && draft.capabilities.length > 0 && draft.initialRuntimeState.activeGoals.length > 0
    && sections.has("character_brief") && (["self_model", "needs", "values"] as const).some((section) => sections.has(section));
}
