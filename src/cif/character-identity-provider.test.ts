import assert from "node:assert/strict";
import test from "node:test";
import { ReaderCharacterIdentityProvider } from "./character-identity-provider.js";
import type { IdentitySection } from "./types.js";

test("CharacterIdentityProvider expands known context tags and preserves stored versions", async () => {
  let selected: readonly IdentitySection[] | undefined;
  const provider = new ReaderCharacterIdentityProvider({ listIdentity: (_sessionId, _characterId, sections) => {
    selected = sections;
    return [{ id: "identity:growth", sessionId: "demo", characterId: "mash", section: "growth_boundaries", content: "Change gradually.", sourceIds: ["evidence:1"], version: 3 }];
  } });
  const identity = await provider.getIdentity({ sessionId: "demo", characterId: "mash", contextTags: ["major_confirmed"] });

  assert.ok(selected?.includes("values"));
  assert.ok(selected?.includes("growth_boundaries"));
  assert.equal(identity[0]?.version, 3);
});
