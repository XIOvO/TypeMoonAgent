import assert from "node:assert/strict";
import test from "node:test";
import type { CifPublicationController, CifPatternDraftView } from "../../core/cif-publication.js";
import { bootstrap } from "../../platform/bootstrap.js";
import { CordisPlatformAdapter } from "../../platform/cordis-platform.js";
import {
  createCifPublicationPlugin,
  type CifPublicationPublisher,
  type CifPublicationStore,
  WORLD_CIF_PUBLICATION_CAPABILITY,
} from "./cif-publication.js";

test("feature cif-publication uses abstract review and publication ports", async () => {
  let draft: CifPatternDraftView = {
    id: "draft-1",
    sessionId: "demo",
    characterId: "mash",
    triggerEpisodeId: "episode-1",
    status: "pending_review",
    proposal: {},
    validationErrors: [],
    generator: "test",
    createdAt: "2026-08-20T00:00:00.000Z",
  };
  const store: CifPublicationStore = {
    listPatternDrafts: () => [draft],
    getPatternDraft: (draftId) => draftId === draft.id ? draft : undefined,
    setPatternDraftStatus: (_draftId, status, reviewedAt) => { draft = { ...draft, status, reviewedAt }; },
  };
  let published = 0;
  const publisher: CifPublicationPublisher = {
    publish: () => { published += 1; draft = { ...draft, status: "published" }; return draft; },
  };
  const running = await bootstrap(new CordisPlatformAdapter(), {
    profileId: "cif-publication-ports",
    plugins: [{ plugin: createCifPublicationPlugin(store, publisher) }],
  });
  const controller = running.get<CifPublicationController>(WORLD_CIF_PUBLICATION_CAPABILITY);

  assert.equal(controller.approvePatternDraft("demo", draft.id).status, "approved");
  assert.equal(controller.publishPatternDraft("demo", draft.id).status, "published");
  assert.equal(published, 1);
  assert.throws(() => controller.publishPatternDraft("other-session", draft.id), /unknown_pattern_draft/);
  await running.dispose();
});
