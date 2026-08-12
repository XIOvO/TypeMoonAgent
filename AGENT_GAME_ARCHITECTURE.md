# Agent Game 整体架构

> 本文为初版通用蓝图。包含 CIF 持久角色、Pi Agent、GM / Settlement 与数据库整合的当前推荐版本见 [docs/architecture-v0.2.md](docs/architecture-v0.2.md)。

## 1. 架构目标

这是一个由 Agent 驱动的 Web 游戏运行时（Agent-driven Web Game Runtime）。

- **Agent**：理解玩家意图、扮演角色、基于已知信息作出判断，并提出行动。
- **Game Runtime**：保存客观事实、验证规则、推进时间与世界，并裁决 Agent 提议的行动。
- **数据层**：持久化游戏状态、事件、角色认知与可检索资料。
- **RAG**：从大量设定、角色知识与游戏记忆中，仅取回当前相关的少量信息。
- **MCP / Tools**：将查询、检索与受控操作包装为 Agent 可调用的认知接口。
- **Web 前端**：呈现叙事、对话、状态、地图与交互；不承担世界裁判职责。

核心原则是：**Agent 可以提出“想做什么”，但不能直接改写“世界发生了什么”。**

## 2. 分层与职责

```text
玩家 / Web 前端
        │ PlayerAction
        ▼
┌────────────────────────────────────────────┐
│              Game Runtime                   │
│ 输入解析 · 权限/规则校验 · 状态推进 · 裁决    │
│ 生成 Observation / 接收 AgentAction          │
└───────┬──────────────────────────┬──────────┘
        │                          │
        │ Observation              │ GameEvent / UI State
        ▼                          ▼
┌──────────────────────┐    ┌───────────────┐
│     Agent Layer       │    │   Web 前端     │
│ 角色理解、判断与决策   │    │ 叙事与交互呈现  │
└──────────┬───────────┘    └───────────────┘
           │ Tools / MCP
           ▼
┌────────────────────────────────────────────┐
│       Retrieval & Structured Data Layer     │
│ Memory RAG · Knowledge RAG · Lore RAG       │
│ GameState · CharacterState · Event Log      │
└────────────────────────────────────────────┘
```

### Agent Layer

角色 Agent 的工作是基于当前观察作出符合角色的反应，例如对话、协作、调查、战斗意图或拒绝行动。角色的内部模型可由以下结构组成：

- `Identity`：身份、背景、稳定设定。
- `Personality / Values / Needs`：人格、价值取向、需求与行为倾向。
- `Knowledge`：该角色**已经知道**的客观信息。
- `Memory`：该局游戏中角色亲历或被告知的事件。
- `Belief`：角色对不确定事项的主观看法，可与客观事实不同。
- `Social Model`：角色对玩家和其他人物的关系、信任、印象与互动历史。

它们首先是数据与认知模块，而不是每轮各自运行一次的独立 LLM Agent。

### Game Runtime

Runtime 是唯一的世界裁判与状态写入方，负责：

- 把前端输入规范化为 `PlayerAction`。
- 根据地点、时间、属性、权限和规则验证行动是否合法。
- 构造最小必要的 `Observation` 给相关角色。
- 接收并校验 `AgentAction`，计算行动结果。
- 写入不可变或可追溯的 `GameEvent`。
- 更新 `GameState`、`WorldState`、`CharacterState` 与前端所需 UI 状态。

因此，Agent 不能直接修改金钱、好感、伤害、位置、任务完成状态或世界真相；它只能请求 Runtime 执行相应行为。

### Web 前端

前端负责让系统成为游戏，而不是聊天工具：

- 玩家输入与行动选择。
- 对话、叙事、角色状态、事件结果的展示。
- 地图、背包、任务、关系、日志等界面。
- 通过 API / WebSocket 接收 `GameEvent` 与可渲染状态。

前端不应保存权威世界状态，也不应绕过 Runtime 直接调用角色 Agent。

## 3. 核心数据契约

建议先稳定以下四种数据结构，其他功能围绕它们扩展。

```text
PlayerAction
  玩家明确输入或选择的行为。

Observation
  Runtime 发给某个 Agent 的、经视角和权限过滤后的当前信息。

AgentAction
  Agent 提议的行动、说话内容、目标、理由与可选工具请求。

GameEvent
  Runtime 裁决后确认发生的事实；是日志、回放、状态更新和记忆生成的共同来源。
```

推荐的主流程：

```text
PlayerAction
  → Runtime 规则检查
  → 最小 Observation
  → Character Agent
  → AgentAction
  → Runtime 裁决
  → GameEvent
  → 状态更新与前端渲染
```

## 4. RAG：三个彼此隔离的检索层

RAG 不应是一个所有角色都可访问的“万能百科”，而应按信息来源和可见性分层。

| 检索层 | 保存内容 | 面向对象 | 关键约束 |
| --- | --- | --- | --- |
| Lore RAG | 世界观、规则、地点、历史、原作设定 | 作者层 / Runtime / 经授权的 Agent | 不可直接让普通角色获得未知真相 |
| Character Knowledge RAG | 角色已掌握的知识、已解锁设定、被告知信息 | 对应角色 Agent | 必须按角色、剧情进度和权限过滤 |
| Memory RAG | 本局中的个人经历、重要对话、共同事件 | 对应角色 Agent | 只召回相关的少量历史，不代替完整日志 |

对应关系：

```text
Lore RAG       = 世界原本是什么（作者视角）
Knowledge RAG  = 角色目前知道什么
Memory RAG     = 角色在本局经历过什么
```

例如，普通 NPC 不应因为查询了 Lore RAG 就知道幕后真相；角色回答时只能使用其 `Observation`、已授权知识和个人记忆。

## 5. MCP / 工具：Agent 的受控认知接口

Agent 不必了解向量库、嵌入模型或数据库细节，只需调用语义清晰、权限受控的工具，例如：

```text
recall_memory(query)
search_known_facts(query)
search_relationship_history(target, query)
inspect_visible_scene()
request_action(action, target, parameters)
```

必要时可提供由 Runtime 或导演 Agent 专用的 `search_lore()`，但角色工具集必须与作者/裁判工具集隔离。

工具调用结果同样需要经过权限过滤、数量限制和审计记录。

## 6. 性能设计：热路径与冷路径

系统的复杂度不应等于每轮的调用数量。瓶颈通常是 LLM 调用和上下文长度，而不是规则代码或数据库查询。

### 热路径：玩家正在等待

用于普通对话和即时交互，目标是尽量少的上下文与调用：

```text
PlayerAction
  → Runtime
  → 小型 Observation
  → 1 次相关 Character Agent 调用
  → Runtime 裁决
  → GameEvent / 前端显示
```

一句“早上好”通常应当是：**0 次 RAG + 1 次 LLM 调用**。

不要在每轮固定启动 Memory、Knowledge、Belief、Emotion、Social、World Director、Narrative 等多个独立 Agent。大多数角色认知状态应以紧凑的结构化字段随 Observation 提供，检索仅在确有需要时触发。

### 冷路径：不阻塞当前回复

在玩家已经看到本轮结果后异步进行：

- 事件重要性判定与记忆写入。
- 长期记忆压缩、摘要与向量化。
- 信念、关系、情绪与长期需求的渐进更新。
- 背景 NPC 模拟、世界时间推进与 World Director 规划。
- 事件归档、分析与索引维护。

冷路径的输入应优先来自已确认的 `GameEvent`，这样可避免模型输出尚未被裁决就污染长期状态。

## 7. Agent 调度策略

1. **按相关性唤醒**：当前场景中真正受影响的角色才参与即时决策。
2. **默认单 Agent**：普通互动优先只调用当前角色 Agent。
3. **按需检索**：Agent 在不确定或需要回忆时再使用知识/记忆工具。
4. **导演按条件介入**：World Director 用于剧情节点、场景切换、冲突升级或后台世界推进，不应参与每一句日常对白。
5. **Runtime 最终裁决**：多 Agent 冲突、规则判定、数值更新和叙事事实均以 Runtime 结果为准。

## 8. 推荐的持久化模型

```text
GameState           当前可运行的全局游戏状态
WorldState          时间、地点、环境、任务、公共世界变量
CharacterState      位置、数值、已知信息索引、关系摘要等
EventLog            经 Runtime 确认的 GameEvent 序列
Memory Store        角色记忆正文、摘要、重要性、向量与元数据
Knowledge Store     按角色/阵营/进度授权的知识条目
Lore Store          作者层世界设定与规则资料
```

`EventLog` 建议成为最重要的事实来源：状态可以重建、记忆可以重新压缩、前端可以回放，且便于调试“为什么角色会知道这件事”。

## 9. 权限与一致性原则

- **事实与认知分离**：WorldState 是客观事实；Knowledge、Memory、Belief 是角色视角。
- **可见性过滤**：每份 Observation、每个检索结果都按角色身份、地点、阵营与剧情进度过滤。
- **事件先于长期更新**：先由 Runtime 写入已确认事件，再异步更新记忆、关系和信念。
- **最小上下文**：只给 Agent 当前行动所需的状态、关系摘要和少量检索结果。
- **可追溯性**：记录 Agent 使用的工具、检索来源、提议行动及 Runtime 裁决结果。

## 10. 最小可行版本（MVP）

建议先实现一条闭环，而不是一开始制作完整多 Agent 世界模拟：

1. 一个场景、一个玩家、一个角色 Agent。
2. `PlayerAction → Observation → AgentAction → GameEvent` 完整数据流。
3. Runtime 对位置、时间、对话权限和少量数值进行权威校验。
4. Event Log 与基础 CharacterState 持久化。
5. `recall_memory()` 和 `search_known_facts()` 两个按需工具。
6. 前端展示对话、事件结果与当前场景状态。
7. 在闭环稳定后，再加入 World Director、多人场景、异步背景模拟、复杂战斗与完整 Lore RAG。

## 11. 一句话总结

**Agent 负责“像角色一样思考”，Runtime 负责“让世界可信地发生”，RAG 负责“只想起当前需要知道的事”，前端负责“让玩家看见并参与这一切”。**
