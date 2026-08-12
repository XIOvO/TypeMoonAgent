# 战斗参与方式（MVP）

战斗中的自然语言不直接修改血量或宣布胜负。Pi 在同一次 `submit_turn_proposal` 中把输入归为一项候选 `BattleDirective`，Runtime 再验证并结算。

```text
玩家输入
  → Pi：command / delegate / quick_resolve 候选
  → Runtime：验证战斗状态、角色与目标
  → battle_round_resolved / battle_finished
  → 数据库快照、事件流与前端状态
```

## 三种方式

| 方式 | 典型输入 | Runtime 的当前 MVP 行为 |
| --- | --- | --- |
| `command` | “玛修攻击左边的敌人，我防御。” | 逐项验证后结算攻击、格挡、撤退等基础意图。 |
| `delegate` | “玛修你来判断战术。” | 指定或全部可行动的同行者，对首个存活敌人执行默认攻击。 |
| `quick_resolve` | “尽快解决”“跳过这场战斗” | 仅在玩家明确要求时启用；按双方当前 HP 总量给出原型胜利或撤离结果。 |

`quick_resolve` 的规则只是占位结算器，事件会带 `prototype: true`。后续替换为职阶、技能、宝具、随机性与自动战斗模拟时，不需要改变 API 或前端输入形式。

## Runtime 状态

`GameState.battle` 只有战斗进行时才存在（或为 `status: active`）。其中保留双方 HP、状态、回合、目标和最终结果；浏览器通过 `/state` 获得一个安全的战斗投影，用于血条和状态栏。

创建战斗仍属于剧情/世界模块的职责，而不是玩家可以直接调用的行动。剧情节点或 GM 只能通过 `Runtime.startBattle()` 提交 `RuntimeBattleStartRequest`：它必须声明地点、目标、在场盟友和敌人。Runtime 会校验盟友确实在该地点、HP 合法且当前没有活动战斗，再写入 `battle_started` 事件。

这样玩家不能靠一句“进入战斗”伪造客观世界事实；玩家的输入只在已存在的战斗中解释为参与方式。
