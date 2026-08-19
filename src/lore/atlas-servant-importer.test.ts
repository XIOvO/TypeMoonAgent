import assert from "node:assert/strict";
import test from "node:test";
import { buildServantProfileBundle } from "./atlas-servant-importer.js";
import { SqliteLoreRepository } from "./sqlite-repository.js";

test("Servant Profile importer preserves unlock conditions as source-linked canon evidence", () => {
  const built = buildServantProfileBundle({
    region: "CN", sourceUrl: "https://example.test/nice_servant_lore.json", localPath: "nice_servant_lore.json",
    fetchedAt: "2026-08-14T00:00:00Z", contentSha1: "source-sha", servant: {
      id: 800100, collectionNo: 1, name: "玛修·基列莱特", originalName: "玛修", className: "shielder", rarity: 4,
      gender: "female", attribute: "earth", profile: { cv: "高桥李依", illustrator: "武内崇", stats: { endurance: "A" }, comments: [
        { id: 1, condType: "svtFriendship", condValues: [2], condMessage: "羁绊 Lv.2", comment: "[r]守护同伴是她的愿望。" },
      ] },
    },
  });
  assert.equal(built.profile.collectionNo, 1);
  assert.equal(built.entries[0]?.unlockCondition.type, "svtFriendship");
  assert.match(built.bundle.fragments[1]?.text ?? "", /守护同伴/);
  const repository = new SqliteLoreRepository();
  repository.replaceDocument(built.bundle);
  repository.replaceServantProfile(built.profile, built.entries);
  assert.equal(repository.countServantProfiles(), 1);
  assert.match(repository.search("守护同伴", 1)[0]?.text ?? "", /守护同伴/);
  repository.close();
});
