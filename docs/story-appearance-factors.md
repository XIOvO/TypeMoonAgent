# 动态角色出现因素

`CharacterAvailability` 仍然是角色出现的第一道门：它定义原作章节、地点与触发信号允许谁成为候选。它防止角色脱离其原作时间线而随意出现。

在通过该门之后，`StoryDirector` 会读取 `CharacterAppearanceFactors`，将本局历史已经沉淀到 CIF 的小型结构化投影用于排序：

```text
章节 / 地点 / 信号资格
  -> 已发布 CIF，且角色尚未在场
  -> AppearanceFactors（目标、事件反应、关系、可用性）
  -> 推荐列表与可审计理由
  -> Story / GM 选择
  -> Runtime 再次校验并正式引入
```

## 字段与含义

| 字段 | 作用 | 更新来源 |
| --- | --- | --- |
| `activeGoals` | 说明角色此刻在意或正在追求什么，并进入推荐理由 | CIF 初始化；后续记忆/关系整合 |
| `responseWeights` | 将客观世界信号标签映射到排序分数，例如 `player_in_danger: 0.4` | CIF 初始化后的规则配置；后续整合 |
| `relationshipWeights` | 将对象 ID 映射到排序分数，例如 `player: 0.2` | 关系模型的低频整合 |
| `availability` | `free` 正常候选，`busy` 降权，`blocked` 排除 | 世界事件、角色状态、GM/规则 |

`StorySignal.tags` 必须来自 Runtime、规则或世界状态的客观判定，例如 `player_in_danger`、`ally_request`。Director 不从玩家文本或 CIF 自行猜测标签。

## 为什么不用每次读取完整 CIF

完整 CIF 适合角色 Agent 进行深层理解；角色是否可能及时到场是高频、确定性的世界问题。`AppearanceFactors` 是由 CIF 与已发生历史在冷路径更新的“热路径投影”：查询一次 SQLite 行即可完成候选排序，不增加 LLM 调用，也保留更新来源和排序理由。

当前发布器会在角色 CIF 发布时创建默认因素：继承初始目标，关系/反应权重为空，状态为 `free`。后续的记忆整合器应只在场景结束、重大事件或关系阶段变化时更新这些字段。
