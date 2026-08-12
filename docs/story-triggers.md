# 确定性 Story Trigger（MVP）

当前 Story Director 不是持续运行的 LLM，也不是“自动续写原作”。它读取明确、可测试的剧情信号与 `CharacterAvailability` 数据，推荐此刻合理的登场候选。

```text
StorySignal(opening_confirmed, chaldea:arrival)
  → 玩家位于 chaldea_hall？
  → 查找同章节、同地点、同信号的角色候选
  → 排除已登场或 CIF 未发布的角色
  → 按权重和世界状态排序
  → 推荐玛修
  → Story / GM 明确选择后，Runtime.introduceCharacter(mash, chaldea_hall)
```

这条开局配置的目的，是跑通新存档中“开局确认后，在迦勒底大厅推荐玛修登场”的最小案例。

## CharacterAvailability

当前玛修样例位于 `src/story/availability.ts`：

```ts
{
  characterId: "mash",
  storyPointIds: ["chaldea:arrival"],
  signalTypes: ["opening_confirmed"],
  locations: ["chaldea_hall"],
  baseWeight: 0.8,
  modifiers: { playerAlone: 0.2 }
}
```

它不是玩家文本分支。无论玩家用什么方式完成开局，只要世界被归纳为同一个 `StorySignal`，Director 就会根据同一套世界状态和候选数据给出排序。以后可从 JSON、SQLite 或作者工具加载相同结构，而不用修改 Director 代码。

## 为什么不用 LLM

- 角色能否登场是客观世界状态，不能由角色模型或叙事模型擅自决定；
- 条件应可回放、可测试、可存档；
- 后续即使加入 Director Agent，它也只能提出 StorySignal / 引入请求，Runtime 仍做最终校验。

## 当前接线状态

`StoryDirector.recommend()` 与 `introduce()` 已完成并有测试，但尚未接到“玩家提交开局信息”的具体 UI/存档流程。这是下一小步：开局创建器在用户确认开局信息后，构造 `opening_confirmed` 信号、展示或自动选择推荐结果，再交给 Runtime；它不需要每回合调用 LLM。
