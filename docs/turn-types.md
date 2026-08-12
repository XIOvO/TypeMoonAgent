# 三类玩家回合输入

玩家请求分为三条**输入通道**，但全部进入同一个 `GameRuntime`：

```text
对话 / 行动 / 战斗
        ↓
规则校验 → Observation（如需角色回应）→ AgentAction → GameEvent
```

## 对话 `dialogue`

用于发言、提问、协商、劝说或威胁。必须有 `content` 和同场 `targetIds`。目标角色收到受限 `Observation`，Pi 只能返回表达与被 Runtime 审核的行动请求。

## 行动 `action`

行动是开放输入。`content` 可以描述任意尝试；`parameters.intent` 只是给规则路由的可选提示，**不是封闭枚举**。Runtime 仅对已有确定性规则的快捷意图立即结算：

| 子类型 | 当前状态 | 结果 |
| --- | --- | --- |
| `move` | 已实现 | `character_moved` |
| `observe` | 已实现 | `area_observed`，只含当前可见范围 |
| `wait` | 已实现 | `time_waited`；之后可接入世界时间推进 |
| 其他任意意图 | 开放 | 暂无对应 Resolver 时返回 `action_rejected(action_requires_resolver)`，绝不虚构结果 |

示例：

```json
{
  "type": "action",
  "actorId": "player",
  "parameters": { "intent": "move", "destination": "cafeteria" }
}
```

自由行动示例：

```json
{
  "type": "action",
  "actorId": "player",
  "content": "我绕到控制台侧面，检查是否有隐藏接口。",
  "parameters": { "intent": "inspect_hidden_interface", "approach": "side" }
}
```

后续接入 `ActionResolver` 后，它会在可见世界状态、角色能力与地点规则的边界内解释这类尝试，并产出受验证的事件；不会让 Pi 或玩家文本直接改写世界。

## 战斗 `combat`

用于声明 `attack`、`defend`、`cast` 或 `retreat` 等意图。当前 Runtime 会返回 `combat_not_initialized`，不会虚构命中、伤害或魔术结果。

战斗应在后续由独立的确定性状态机处理：先校验战斗场景、回合/时序、距离、资源与状态，再写入统一的 `GameEvent`。Pi 可以提出战术意图，但绝不能直接计算伤害或修改 HP。
