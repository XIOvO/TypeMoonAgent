import { randomUUID } from "node:crypto";
import type { CifDraftGenerator, CifInitializationBrief, CifInitializationDraftRecord } from "./initializer.js";
import { validateCifInitializationDraft } from "./initializer.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

/** Runs an initializer worker once, validates its output, then stores an unpublished audit draft. */
export class CifDraftService {
  public constructor(private readonly repository: SqliteCifRepository, private readonly generator: CifDraftGenerator, private readonly generatorName: string) {}

  public async create(brief: CifInitializationBrief): Promise<CifInitializationDraftRecord> {
    const draft = await this.generator.generate(brief);
    const validationErrors = validateCifInitializationDraft(brief, draft);
    const record: CifInitializationDraftRecord = {
      id: randomUUID(), status: validationErrors.length ? "invalid" : "draft", brief, draft, validationErrors,
      generator: this.generatorName, createdAt: new Date().toISOString(),
    };
    this.repository.saveInitializationDraft(record);
    return record;
  }
}
