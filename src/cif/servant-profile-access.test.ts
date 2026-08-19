import assert from "node:assert/strict";
import test from "node:test";
import { buildServantProfileBundle } from "../lore/atlas-servant-importer.js";
import { SqliteLoreRepository } from "../lore/sqlite-repository.js";
import { CifInitializer } from "./initializer.js";
import { ServantProfileAccessPolicy } from "./servant-profile-access.js";
import { SqliteCifRepository } from "./sqlite-repository.js";

test("CIF initialization only receives Servant Profile entries unlocked by the player's bond", () => {
  const lore = new SqliteLoreRepository(); const game = new SqliteCifRepository();
  const built = buildServantProfileBundle({ region: "CN", sourceUrl: "https://example.test/servants", localPath: "servants.json",
    fetchedAt: "2026-08-14T00:00:00Z", contentSha1: "source", servant: { id: 800100, collectionNo: 1, name: "玛修·基列莱特",
      profile: { comments: [
        { id: 1, condType: "none", comment: "初始资料：她是亚从者。" },
        { id: 2, condType: "svtFriendship", condValues: [2], comment: "羁绊二级资料：她信任前辈。" },
      ] },
    } });
  lore.replaceDocument(built.bundle); lore.replaceServantProfile(built.profile, built.entries);
  const initializer = new CifInitializer(lore, new ServantProfileAccessPolicy(lore, game));
  const request = { sessionId: "demo", playerId: "player", characterId: "mash", displayName: "玛修", aliases: ["玛修·基列莱特"],
    variantId: "early", storyPointId: "start", introduction: { locationId: "hall", presentEntityIds: ["player"], reason: "story_trigger" as const },
    canonScope: { region: "CN" } };
  const before = initializer.buildBrief(request, 4);
  assert.ok(before.evidence.some((item) => item.excerpt.includes("初始资料")));
  assert.ok(!before.evidence.some((item) => item.excerpt.includes("羁绊二级")));
  game.grantBond({ actionId: "bond-1", sessionId: "demo", playerId: "player", characterId: "mash", points: 10,
    sourceEventIds: ["event-1"], createdAt: "2026-08-14T00:00:00Z" });
  const after = initializer.buildBrief(request, 4);
  assert.ok(after.evidence.some((item) => item.excerpt.includes("羁绊二级")));
  lore.close(); game.close();
});
