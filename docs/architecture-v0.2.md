# Agent Game 整体框架 V0.2：持久角色 + Pi Agent + 事件世界

## 0. 最高设计规则：程序优先、AI 提案、Runtime 裁定

> **AI 是叙事与角色表现的必要服务；Runtime 是世界一致性与可恢复性的必要核心。**

本项目采用 **Program-first, AI-proposes, Runtime-commits** 作为所有模块共同遵守的最高规则：

```text
固定程序拥有：世界状态、游戏内时间、规则结算、战斗、任务、存档、事件日志与前端投影。
AI 只能：读取被授权的上下文，并提出角色行动、剧情机会、记忆/关系更新或时间中断建议。
Runtime 必须：校验权限、前置条件、可见性、规则与幂等性；确认或拒绝提案；
              写入唯一有效的 GameEvent，并据此更新状态与前端。
```

AI 不得直接修改数据库、WorldState、游戏时钟、战斗结果、任务状态或前端可见事实；任何 AI 产出在未经 Runtime 裁定前均只是提案。

若 AI 模型超时、断连或不可用，依赖 AI 的剧情与角色表现可以暂停或向玩家明确报错；但已经确认的世界状态、事件、时间、存档与后台任务不得损坏、半提交或变为矛盾。AI 恢复或更换后，系统必须能从同一份持久状态继续运行。未来可选的确定性“单机降级模式”不属于当前 MVP 的前提。

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

## 2.1 插件组合层：能力可替换，事实不可绕过

系统采用游戏自有的插件协议，并以 DeepSeek Harness 发布的 `@deepseek-ai/cordis` 作为当前生命周期平台。`bootstrap(platform, composition)` 是唯一的无业务启动入口；`composition` 显式列出启用的插件、版本、依赖与能力。

```text
Composition Root（仅装配）
  ├─ system.durable-jobs       → world.jobs / world.eventTasks
  ├─ system.persistence        → world.eventHistory / system.turnCommitter
  ├─ system.world-state        → world.state
  ├─ system.command-authority  → world.commandGateway
  ├─ system.world-map          → world.map
  ├─ system.world-navigation   → world.navigation
  ├─ feature.world-simulation  → world.simulation
  ├─ feature.story-chapters    → world.storyChapters
  ├─ feature.story-summon      → world.storySummon
  ├─ feature.memory-consolidation → world.memoryConsolidation
  ├─ feature.cif-patterns      → world.cifPatterns
  ├─ feature.cif-publication   → world.cifPublication
  └─ future: feature.*         → 战斗、CIF、前端适配
```

每个插件必须声明 `requires`、`provides`、配置版本以及其拥有的事件/耐久任务种类。启动前拒绝重复能力、缺失依赖和循环依赖；卸载时撤销监听器、worker 与临时资源。插件只能通过已声明的能力协作，不能绕过 `world.commandGateway` 直接写入已确认世界事实。

插件是“可替换的系统积木”，不是“任意数据都可卸载”。角色档案、记忆、存档和已确认事件仍是持久事实；插件定义的是读取、处理和受控改变这些事实的能力。当前 `GameRuntime` 仍是写权兼容实现，后续会被逐步收束为核心规则插件，而不是在一次重写中替换。

剧情的“进入章节”和“召集角色”已按职责拆开：`feature.story-chapters` 统一主线、活动的新开与续玩，并经命令网关确认进入；`feature.story-summon` 将章节开场与后续时间推进转为可恢复任务，再只经命令网关请求同场互动或单步跨地点接近。因此活动点击与主线条件满足共享一条安全链路，但内容包、分支规则和原子投影仍属于章节持久领域，尚不开放给任意插件改写。

角色记忆采用同样的冷热分层：确认事件的热路径只写客观历史、可见证据和耐久任务；`feature.memory-consolidation` 在冷路径消费 `memory.l1`，让模型在隔离证据上提议一段角色专属回忆，再由程序保留来源链并输出不含私密解释的 GM 投影。L2 的生成、审核和发布被拆为独立耐久阶段，避免把“记住一件事”和“改变长期判断”混为同一次后台调用。

L2 的跨场景模式归纳由 `feature.cif-patterns` 处理：`memory.l2` 至少在两段 L1 记忆共同支持、且包含本次触发记忆时，才可冻结一项关系解释、可错信念或重复目标提案；`memory.l2.audit` 交由独立审核 AI 判断。审核结论只能是批准、暂缓或拒绝，且必须附带来源、理由、风险级别与策略版本；程序二次校验后，仅低风险批准可自动发布。人格、价值观与 CIF 身份段落仍明确属于更高门槛的 L3 修订流程。这样既保留长期成长的证据链，也不会让一次模型调用悄悄改变角色。

`feature.cif-publication` 是 L2/L3 的共同发布边界：审核 AI 提供可验证结论，发布器重读批准状态，并在同一事务内保留审核结论、来源与版本、更新 live 状态和完成任务。玩家不会看到也不参与审核；上下文只读取最新有效判断。L0 的确认事件与 L1 的场景记忆不会经由此插件改写。L3 已拥有同一生成、审核与版本化发布闭环，但只允许独立策略安排的 `memory.l3` 任务进入；它默认只可渐进修订适应和表达层，不会自动改写核心人格。

`feature.scene-lifecycle` 订阅事务内事件任务，但不拥有 Runtime 的裁决权。它把已确认事件投影为可恢复的 `scene_opened`、`interaction_settled`、`scene_closed` 与场景阶段记录：首次有效玩家互动打开场景，玩家移动关闭旧场景并打开新场景，战斗只切换阶段。它不以墙钟时间关闭场景，也不调用 AI；前台、记忆策略与未来 GM 都应读取这一投影，而不是自行猜测场景边界。

`feature.interaction-coordinator` 生成可解释的参与计划，并拥有 `interaction.execute` 工作流：执行单与 Outbox 使用同一玩家动作幂等键；worker 重启后可恢复动作、主回应者和尝试状态，只经命令网关调用 Runtime。只有确认得到 `character_spoke` L0 事件才标记完成；无回应为跳过，异常由耐久队列退避重试。执行单不是 L0，不能把模型失败伪装成世界事实。当前 API 尚未把未点名对话的入口迁移到执行单，普通对话仍走同步兼容路径；这是下一次迁移的唯一入口缺口。

## 2.2 空间与地图：当前最小模型不等于正式地图

当前世界只具备最小空间模型：`GameState.locations` 保存地点及出口，`nextStepToward()` 在出口图上计算一条最短下一步路径。它已足以支持相邻移动、跨地点接近玩家与剧情召集，但不是完整地图系统。

正式地图将分为两个独立层：

```text
静态地图拓扑（world.map）
  区域 / 楼层 / 场景节点 / 路径 / 单双向 / 进入条件 / 基础代价
             +
动态世界状态（world.state）
  封锁、门锁、破坏、剧情开放、临时危险、玩家已探索范围
             ↓
导航能力（world.navigation）
  可达性、下一步、完整路线、预计时间与不可达原因
```

`world.map` 与 `world.navigation` 只回答空间事实和查询，不能自行移动角色、推进时间或开启剧情；这些变化仍由 `world.commandGateway` 接收的受控命令确认。地图 UI、迷雾、传送、路线成本和动态封锁会在地图领域模型稳定后逐步接入，而不会把当前 `exits` 数组直接暴露为永久公共协议。详见 [地图与导航设计](map-and-navigation.md)。

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
GameEvent / Runtime-created world job
  → durable Job / Outbox（幂等键、状态、重试）
  → Consolidation / Simulation worker
  → Memory summary / Belief / Relationship / long-term emotion update
  → Runtime commit（若改变客观事实）/ Database（若仅为派生认知）
```

这样“实时记录 + 延迟整合”替代“每个事件都实时总结”，可同时降低成本、延迟和长期状态噪声。Job 必须和触发它的事件在同一持久化事务中写入；不得只用进程内事件订阅作为唯一投递机制。

### 8.1 后台连续性：按需模拟，不是常驻思考

世界推进由 Runtime 的确定性时钟、章节压力或玩家回归触发。它先筛选受影响角色并创建 `SimulationJob`，再按预算唤醒必要的 Agent：

```text
WorldTick / player_return / story_pressure
  → Runtime 规则筛选角色
  → SimulationJob（持久化、可重试、可审计）
  → Agent 提出角色意图或叙事机会
  → Runtime 裁决
  → GameEvent → 状态、记忆与前端投影
```

因此角色能够拥有离场期间的连续经历，同时避免为大量 NPC 常驻运行 LLM。

## 9. 从当前骨架到完整版本

当前项目已实现：SQLite 持久化 Runtime、事件序列、幂等命令、角色 Observation、受控 Pi Agent adapter，以及第一批系统插件（任务队列、已提交世界状态、命令权威）。

后续顺序：

1. 实现基于 Canon Source Pack、角色变体与剧情时间点的 [角色 CIF 初始化流程](character-initialization.md)。
2. 为 Runtime 增加 HTTP / WebSocket API，并接入最小对话 UI。
3. 用 SQLite 实现 Event Log、WorldState、CharacterState、CIF sections 与 Memory 的持久化仓储。
4. 添加 `recall_memory`、`search_known_facts`、`inspect_visible_scene` 等游戏工具及权限过滤。
5. 将冷路径任务统一为持久化 Job / Outbox；把现有记忆整合作为首个消费者。
6. 新增受预算约束的 `WorldTick` / `SimulationJob`，先支持少量角色的按需世界推进。
7. 扩展到多角色调度、复杂规则和条件触发的 GM / World Director。

## 10. 一句话总括

**角色长期活在数据库里；CIF 定义“她是谁”，记忆与认知定义“她经历和相信什么”，Context Builder 决定“她这一刻知道什么”，Pi 决定“她想做什么”，Runtime 决定“世界实际发生什么”，GameEvent 让一切可回放、可追溯并呈现在前端。**
