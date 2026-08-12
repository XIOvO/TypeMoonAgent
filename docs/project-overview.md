# Agent Game：整体框架总览

这是一个面向单人本地游玩的 Agent Game。Pi Agent 负责角色的理解、判断和受限意图；`GameRuntime` 是唯一能确认世界事实并改变世界状态的裁判；SQLite 保存长期世界、CIF 与事件；资料库为角色和导演按需提供原作证据。

```text
Web Frontend
    │ PlayerAction（对话 / 自由行动 / 战斗意图）
    ▼
API
    ▼
GameRuntime ──规则、可见性、事务、事件──► SQLite
    │ Observation
    ▼
Pi Character Agent ◄── CharacterContext ◄── CIF / 记忆 / 受限原作检索
    │ AgentAction（只提出请求）
    └────────────────────────────────────► GameRuntime
                                                 │ GameEvent
                                                 ▼
                                      Renderer / 前端叙事表现
```

## 权威边界

| 模块 | 可以做什么 | 不能做什么 |
| --- | --- | --- |
| 前端 | 收集输入、显示玩家可见状态和叙事 | 读取原始数据库、结算规则 |
| Pi Agent | 解释 Observation、表达角色、申请行动 | 直接改状态、确认行动成功、读取隐藏事实 |
| GameRuntime | 校验、结算、可见性、生成事件 | 擅自编造角色内心或原作资料 |
| CIF | 保存角色主观证据、知识、身份与即时状态 | 当作客观世界事实 |
| SQLite | 持久化世界、事件、CIF 与资料索引 | 替代 Runtime 作裁判 |
| 原作资料库 | 提供可追溯的文本证据和检索 | 强制复读原作或向角色泄露未来剧情 |

## 一次回合

```text
玩家文本
  → PlayerAction
  → Runtime 校验 / 自由行动解析
  → 向在场角色构造受限 Observation
  → 按需读取 CIF、记忆、原作证据
  → Pi 返回 AgentAction
  → Runtime 结算为 GameEvent
 → 原子提交：世界快照 + 事件 + CIF 观察证据
  → 前端根据叙事预设呈现
```

普通对话目标是 `1` 次角色模型调用；普通移动/观察可为 `0` 次。记忆整合、关系更新、章节压力推进等属于低频冷路径，不阻塞玩家。

首次登场使用受信任的 `introduceCharacter` 操作，而非玩家输入：它只接受已发布 CIF 的角色，将其放入有效地点并生成 `character_introduced` 事件。详情见 [character-introduction.md](character-introduction.md)。

## 三类玩家输入

- `dialogue`：角色可听到的发言；必要时触发目标角色 Pi。
- `action`：开放自然语言尝试。`intent` 只是路由提示，不限制玩家可做的事；已有规则立即结算，其他交给后续 `ActionResolver`。
- `combat`：战斗意图。未来由确定性战斗状态机处理；Pi 只表达战术，不计算伤害。

## 原作与可变世界线

Atlas Script 原文是证据层：用于 CIF 初始化、角色表现校准、背景查证和 Director 参考。它不直接驱动每个回合。未来由 `CanonBeat`（原作压力/因果）和 `WorldBranch`（本局真实偏移）实现“可以偏离、仍符合角色逻辑”的章节推进。

当前状态：冬木主线原文已完成切片与 SQLite FTS 索引；首次登场 CIF 已具备时间线过滤、低频 Pi 草案、来源校验与审核后发布。完整实现状态见 [current-status.md](current-status.md)。下一步是将首次登场接入 Runtime 与审核界面，再按正在游玩的章节逐步添加少量 CanonBeat；不进行全量原作人工结构化。
