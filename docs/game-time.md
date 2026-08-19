# 游戏时间：`GameMoment`

`GameMoment` 是世界的权威叙事时间，而不是服务器时间：

```ts
{ timelineId: "session:demo", tick: 42, calendar?: { day: 3, phase: "evening" } }
```

## 本阶段的职责边界

- `timelineId` 标识一条可独立演进的玩家世界线；原作锚点不是 timeline。若同一存档分叉后两条分支会并存，创建分支时必须分配新的 timeline ID。
- `tick` 是非负整数，由 Runtime 的确定性规则推进；它不等于现实秒数，也不由模型决定。
- `calendar` 只保存游戏提供的展示/叙事数据。Runtime 当前不推算日历，避免默认的“每 tick 是一分钟/一天”误导玩法。
- `createdAt` 仍保留为 UTC 操作时间，用于审计、SQLite 更新时间和 Worker 租约；它不能驱动剧情、记忆失效或 NPC 行程。

## 当前推进规则

1. 新 Runtime 若读取旧存档，会初始化为 `{ timelineId: "session:<sessionId>", tick: 0 }`。
2. `wait` 是当前唯一推进时间的玩家动作，每次成功结算推进一个 tick；其 `time_waited` 事件记录推进后的 moment，以及 `fromTick`/`toTick`。
3. 对话、移动、观察、检查、交互与战斗保持当前 tick；模型输出永远不能直接设定或推进时间。
4. 每条新 `GameEvent` 持有产生时的 moment，并与世界状态、事件、收据和派生任务一起原子提交。

## 明确不做

- 不自动在每个玩家输入后推进时间。
- 不新增常驻 NPC 循环、离线推进或后台 Pi 调用。
- 不把 `calendar` 解析、时区或现实时间映射写进 Runtime。
- 不修改既有原作锚点、章节规则或 CIF 记忆策略。

## 按需世界推进

每个确认的 `time_waited` 会在同一提交事务中投递一个 `world.tick` Job，以 `(sessionId, timelineId, tick)` 去重。Worker 只在 Job 的 moment 与当前世界 moment 完全一致时调用确定性 `WorldTickPlanner`；落后的 tick 直接完成，不会在玩家已经继续行动后补做 NPC 行为。

Planner 最多派生角色级 `world.simulation` 候选，去重键为 `(timelineId, tick, actorId)`。`PresentFreeCharacterWorldTickPlanner` 已提供可复用的确定性筛选策略：只考虑与玩家同地点、`CharacterRuntimeState.availability === "free"`、且有非空 `currentPlan`、`currentIntention` 或 `activeGoals` 的非玩家角色；按角色 ID 排序后每 tick 至多选 2 名。战斗进行中、异地、忙碌/阻塞、缺少运行态及没有待处理目标的角色均不入选。

主程序已注册该筛选策略与 `WorldSimulationWorker`。Worker 领取候选时会重新校验 moment、战斗状态、玩家/角色位置、角色可用性与待处理目标；任一条件失效都会无副作用地完成旧 Job，不会补做离线剧情。主程序把每 tick 的候选上限设为 1，并以 `lastProactiveInteractionTick` 施加 3 tick 冷却。

通过复核后，`RuntimeWorldSimulationExecutor` 会要求角色 Agent 提出一条面向玩家的同场开场白。Runtime 只接受对话：移动、战斗、物品交互和时间推进请求都会拒绝整次候选；正式 `character_spoke` 事件仍由 Runtime 原子提交。特殊能力不属于此阶段。

普通跨地点接近已作为基础设施加入，但默认关闭。角色必须在 CIF 运行态显式拥有 `approachPlayer: "when_safe"`，且其 `knownPlayerLocationId` 与玩家当前地点一致；前者是行为许可，后者只会从角色亲历的玩家移动或等待事件更新，缺失时不视为全知。满足条件时，Worker 将产生 `approach_player` 候选，并锁定该已知地点。Runtime 只按稳定最短路径移动一条相邻边；玩家离开、路径消失、战斗开始或资格变化都会使候选无副作用地失效。抵达后不会同 tick 说话，而是在后续 tick 使用同场开场机制。

未来的模型执行器只能替换该 Worker 的执行器接口，且必须经 Runtime 提交已验证动作；执行器抛错才会按 Job 的重试策略重试。它不得自行修改或跳跃时间，也不得绕开 Runtime 直接写世界状态。
