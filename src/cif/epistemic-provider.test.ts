import assert from "node:assert/strict";
import test from "node:test";
import { ReaderEpistemicProvider, publicStatus } from "./epistemic-provider.js";
import type { EpistemicStatus } from "./types.js";

test("EpistemicProvider keeps known, believed, suspected, and unknown separate", async () => {
  const expected: Record<EpistemicStatus, string> = { accepted: "known", likely: "believed", possible: "suspected", uncertain: "suspected", contested: "suspected", rejected: "unknown", unknown: "unknown", outdated: "unknown" };
  for (const [status, publicValue] of Object.entries(expected)) assert.equal(publicStatus(status as EpistemicStatus), publicValue);
  const provider = new ReaderEpistemicProvider({ listEpistemicStates: () => [{ id: "e1", sessionId: "demo", characterId: "mash", proposition: "The bridge is safe.", status: "accepted", confidence: 0.9, supportingEvidenceIds: ["event:1"], opposingEvidenceIds: [], version: 2 }] });
  assert.deepEqual(await provider.getStates({ sessionId: "demo", characterId: "mash" }), [{ proposition: "The bridge is safe.", confidence: 0.9, status: "known", evidenceIds: ["event:1"], version: 2 }]);
});
