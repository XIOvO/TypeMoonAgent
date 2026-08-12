# Agent Game 整体框架 V0.2：持久角色 + Pi Agent + 事件世界

## 1. 核心定义

这是一个 Agent 驱动的开放世界游戏框架。第一阶段可服务于 FGO / 型月风格的世界模拟，但架构不依赖特定 IP。

角色不再是“一段长期挂在 Prompt 里的角色卡”，也不是“每个角色一个永久运行的 LLM 进程”。角色是数据库中持续存在的实体：

```text
角色
= CIF 长期人格档案
+ 动态认知与心理状态
+ 可追溯的记忆、知识、信念与关系
+ 当前场景临时构建的 CharacterContext
+ Pi Agent 在需要时完成的实时判断
```

**数据库让角色持续存在；Context Builder 在某一回合只唤醒角色当前需要的部分；Pi Agent 仅负责从 Observation 到 AgentAction 的思考。**

## 2. 总体结构

```text
┌──────────────────────────────────────────────────────────────┐
│                         Web Frontend                         │
│ 输入 · 对话/叙事/状态展示 · 地图/任务/关系 UI                  │
└──────────────────────────┬───────────────────────────────────┘
                           │ PlayerAction
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    Game Gateway / API                        │
│ 会话、认证、输入格式、事件流                                  │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│             GM / Settlement Agent + Game Runtime              │
│ 场景调度 · Context Builder · 规则校验 · 行动裁决 · 状态推进     │
│                    唯一权威写入者                             │
└───────┬───────────────────────────────┬──────────────────────┘
        │ Observation                   │ GameEvent / UI state
        ▼                               ▼
┌───────────────────────┐       ┌──────────────────────────────┐
│       Pi Agent        │       │  Event Log / World State      │
│ 角色思考、工具调用、   │       │ 时间、地点、物品、任务、结果   │
│ 提交 CharacterIntent  │       └──────────────┬───────────────┘
└──────────┬────────────┘                      │
           │ MCP / game tools                   │ cold path
           ▼                                    ▼
┌──────────────────────────────────────────────────────────────┐
│                  Character & World Database                  │
│ CIF Profile · Cognitive State · Memory · Knowledge · Belief  │
│ Relationship / Social Model · Lore · Events · Vector Index    │
└──────────────────────────────────────────────────────────────┘
```

## 3. 四个权威边界

| 层 | 回答的问题 | 可以做什么 | 不能做什么 |
| --- | --- | --- | --- |
| 前端 | 玩家想尝试什么、看见什么 | 提交输入、渲染可见事件 | 判定世界结果、保存权威状态 |
| Pi Agent | 角色会如何理解与回应 | 调用授权工具、生成 CharacterIntent / AgentAction | 直接修改世界、获得隐藏真相 |
| Runtime / GM | 客观上发生了什么 | 校验、裁决、写入状态与事件、推进世界 | 将模型猜测自动认定为事实 |
| 数据库 / RAG | 什么长期存在、谁知道什么 | 保存、版本化、过滤、检索 | 自行决定叙事或绕过权限 |

其中 GM / Settlement Agent 是 Runtime 的智能辅助层：它可为场景、叙事节奏与复杂冲突提出建议，但最终仍必须经过规则与事件写入流程。

## 4. 角色数据库：CIF 不被拆散，动态部分可演化

### 4.1 CIF 长期人格档案

CIF 适合保留复杂自然语言人格逻辑，不应粗暴全部拆成数值字段。建议按版本化片段存储：

```text
character_cif_sections
  character_id · section_type · content · version · importance · updated_at

section_type:
  core_identity · core_needs · values · relationship_beliefs
  emotional_structure · defense_patterns · social_behavior
  intimacy · self_model · decision_principles · voice
```

这使 CIF 同时保留“档案”的表达力，并获得版本、更新、检索与局部加载能力。

### 4.2 适合结构化存储的动态层

```text
CharacterState        位置、当前目标、短期情绪、可行动状态
Knowledge             已知的客观信息及解锁/来源
Belief                角色主观看法、置信度与可错性
Relationship          信任、边界、印象、关系阶段与证据
Memory                个人经历、情绪、重要性、人物、地点、来源事件
```

客观世界事实与角色认知必须分开：角色可以错误地相信某件事，WorldState 不会因此改变。

## 5. 运行循环

```text
玩家 / 环境输入
      ↓
PlayerAction：尝试做什么，不代表成功
      ↓
Runtime 前置校验与场景调度
      ↓
Context Builder：世界片段 + 角色片段 + 规则 + 必要检索
      ↓
Observation：该角色此刻能够知道什么
      ↓
Pi Agent：按人格、记忆、知识、信念、关系进行判断
      ↓
CharacterIntent / AgentAction：角色想说什么、想请求什么行动
      ↓
Runtime / Rule Resolution：验证、冲突裁决、确定结果
      ↓
GameEvent：真正发生的可追溯事实
      ↓
WorldState / CharacterState 更新 → 前端显示 → 冷路径整合
```

四个核心对象的语义保持严格：

| 对象 | 含义 |
| --- | --- |
| `PlayerAction` | 玩家**尝试**做什么 |
| `Observation` | 某角色**能够知道**什么 |
| `AgentAction` | 角色**想**做什么 |
| `GameEvent` | 经 Runtime 裁决后**确实发生**了什么 |

## 6. Pi Agent 的具体位置

Pi 不需要修改核心源码，也不应变成游戏引擎。第一阶段通过 Pi SDK 的 `AgentSession`、自定义系统提示词、角色认知资料和受控工具进行嵌入。

```text
Game Runtime
  → 组装 Observation / CharacterContext
  → 调用 Pi AgentSession
  → Pi 使用 MCP / game tools（按需）
  → Pi 调用 submit_game_action
  → Runtime 校验、裁决并写入事件
```

Pi 的角色提示词应固定以下边界：

- 只把 Observation 与授权工具结果视为当前可知事实。
- 根据 CIF、记忆、知识、信念与关系形成角色化意图。
- 不创造隐藏事实，不扮演 Runtime，不宣布未裁决的结果。
- 通过结构化 `submit_game_action` 提交对白与行动请求。

游戏角色不应启用 Pi 的文件读写、Shell 或编辑工具；只暴露游戏专用工具。项目骨架中的 `PiAgentRunner` 已按该规则实现。

## 7. RAG 与认知工具

RAG 分为三层，且先权限过滤、再检索：

```text
Lore RAG       作者层的世界设定与规则；默认不直接提供给普通角色
Knowledge RAG  该角色已掌握的客观资料与已解锁信息
Memory RAG     该角色在本局经历、听闻或形成的个人记忆
```

Pi 看到的是语义工具，而不是数据库实现：

```text
recall_memory(query)
search_known_facts(query)
search_relationship_history(target, query)
inspect_visible_scene()
submit_game_action(utterance, requests)
```

普通对话不必检索；只有不确定、回忆、调查或关系相关时才调用工具。每次返回少量带来源的结果，未命中就表现为不知道或猜测。

## 8. 实时与异步：成本控制原则

数据库本身的读写与索引查询成本很低；真正昂贵的是不必要的模型总结、分析和过长上下文。

### 热路径：即时响应

```text
PlayerAction → Runtime → 最小 Observation → 1 个相关 Pi Agent → 裁决 → GameEvent → UI
```

默认目标是一次角色模型调用、零次检索。人格、短期状态和关系摘要以紧凑结构提供；不在每轮启动记忆、情绪、信念、导演等多个模型任务。

### 冷路径：延迟整合

每轮先机械记录已确认事件；仅在场景/一天结束、累计足够重要事件、重大情绪事件或潜在关系阶段变化时，再批量调用模型：

```text
GameEvent / relationship evidence
  → Consolidation worker
  → Memory summary / Belief / Relationship / long-term emotion update
  → Database
```

这样“实时记录 + 延迟整合”替代“每个事件都实时总结”，可同时降低成本、延迟和长期状态噪声。

## 9. 从当前骨架到完整版本

当前项目已实现：契约、内存 Runtime、事件序列、幂等 PlayerAction、角色 Observation、受控 Pi Agent adapter 与单元测试。

后续顺序：

1. 实现基于 Canon Source Pack、角色变体与剧情时间点的 [角色 CIF 初始化流程](character-initialization.md)。
2. 为 Runtime 增加 HTTP / WebSocket API，并接入最小对话 UI。
3. 用 SQLite 实现 Event Log、WorldState、CharacterState、CIF sections 与 Memory 的持久化仓储。
4. 添加 `recall_memory`、`search_known_facts`、`inspect_visible_scene` 等游戏工具及权限过滤。
5. 增加冷路径 Consolidation worker，先做规则触发和批量记忆生成。
6. 扩展到多角色调度、复杂规则和条件触发的 GM / World Director。

## 10. 一句话总括

**角色长期活在数据库里；CIF 定义“她是谁”，记忆与认知定义“她经历和相信什么”，Context Builder 决定“她这一刻知道什么”，Pi 决定“她想做什么”，Runtime 决定“世界实际发生什么”，GameEvent 让一切可回放、可追溯并呈现在前端。**
