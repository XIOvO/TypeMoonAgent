# 角色引入：从已发布档案到游戏世界

`GameRuntime.introduceCharacter()` 是一个受信任的剧情/GM 操作，不是玩家 API，也不是普通 `PlayerAction`。

```text
已发布 CIF 草案
  → Story / GM 决定登场条件成立
  → introduceCharacter
  → Runtime 验证并写入 GameState
  → character_introduced GameEvent
  → 同地点玩家收到 SSE，之后角色可收到 Observation
```

## 验证规则

- 请求的 `sessionId` 必须与当前世界一致；
- CIF repository 必须证明该角色存在 `published` 初始化草案；
- 角色尚未在 `GameState.characters` 内；
- 指定地点必须存在。

失败时不会改变世界或产生事件。成功时角色被放入地点、写入世界快照，并向同地点实体发布 `character_introduced`。

## 与 CIF 发布的区别

- `CifInitializationPublisher`：角色的身份、知识、关系与初始状态可以使用；
- `GameRuntime.introduceCharacter`：角色此刻才客观存在于这局世界的某个地点；
- Renderer / Pi：随后决定玩家怎样看见她、她怎样说话或行动。

当前还没有 Story Director 自动调用此方法；这是刻意保留的边界，避免“审核通过就自动出场”。
