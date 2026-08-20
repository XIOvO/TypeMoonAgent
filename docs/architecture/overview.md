# Agent Game Runtime 架构总览

> 文档版本：v0.3 Draft
> 文档状态：核心工程文档 / 架构权威入口
> 代码基线：agent/v0.2-runtime-expansion
> 最近核验：2026-08-19

## 0. 文档职责

本文回答三个问题：

1. Agent Game Runtime 要解决什么问题；
2. 哪些架构边界必须长期保持；
3. 当前 v0.2 实现如何演进到目标架构。

公共数据结构和接口由 [API 与协议规范](../specifications/API_SPECIFICATION_V0.3.md) 定义，工程顺序和验收由 [开发路线与任务拆解](../development/DEVELOPMENT_ROADMAP_AND_TASK_BREAKDOWN.md) 定义。专题文档补充具体领域细节，不得反向改变这三份核心文档的职责。

文中的状态含义：

| 状态 | 含义 |
| --- | --- |
| Implemented | 当前代码存在，并有测试或可运行路径佐证 |
| Transitional | 已有一部分边界，但仍保留兼容耦合 |
| Target | v0.3 或更后版本的目标，不代表当前 API 已可用 |

## 1. 项目定义

Agent Game Runtime 是一个面向 AI 原生游戏的事件驱动运行时。它让玩家和 Agent 在持续世界中提出行动，由确定性 Runtime 校验、结算并提交世界事实。

当前仓库同时承担两种职责：

- Runtime 工程：验证世界状态、事件、Agent、插件、CIF、持久化和表现投影之间的稳定边界；
- 参考游戏：以 Fate 风格世界和冬木内容验证一条可玩的垂直切片。

参考世界是 Runtime 的首个验证场景，不应成为 Kernel 的永久依赖。

### 1.1 核心目标

- 让 AI Agent 在持续、可恢复的世界中行动；
- 让模型负责理解、表达和提案，让程序拥有事实和提交权；
- 让角色认知、剧情、战斗、地图、持久化和表现通过明确能力边界组合；
- 让事件、存档和后台任务可追溯、可重试、可迁移；
- 最终允许第三方在不修改 Kernel 的前提下提供世界、能力、Agent 或表现实现。

### 1.2 非目标

- 不替代 Unity、Godot 等图形和物理引擎；
- 不让 LLM 充当数据库、规则裁判或事务协调器；
- 不要求 NPC 常驻思考或按现实时间无限模拟；
- 不在 v0.3 前完成全量 FGO 内容、完整战斗演出或插件市场；
- 不为了抽象而一次性重写现有垂直切片。

## 2. 不可破坏的架构原则

### 2.1 Program-first, AI-proposes, Runtime-commits

玩家输入、模型解释和 AgentAction 都只是候选。只有 Runtime 成功提交的 GameEvent 才是世界事实。

    RawPlayerInput / PlayerAction / AgentAction
                         |
                         v
              validation and settlement
                         |
                         v
                  atomic commit
                         |
                         v
                 GameEvent + State

模型失败可以导致本轮没有角色回复，但不得导致半次提交、幽灵事件或损坏存档。

### 2.2 Kernel owns truth; capabilities own behavior

Kernel 拥有：

- 行动接纳、权限和幂等；
- 会话内顺序与事务边界；
- 事件序列和状态 revision；
- 提交、回滚和发布已提交结果。

Capability 或 Domain Plugin 拥有：

- 战斗、剧情、导航、记忆等领域计算；
- 候选事件、状态变化或任务的产生；
- 可替换的 Agent、数据库、表现和外部服务实现。

功能插件不得绕过 CommandGateway 或 system-only 提交端口直接宣布世界事实。

### 2.3 客观事实、主观认知和表现分离

    L0  GameState / GameEvent         客观事实
    L1-L3 CIF / memory / belief      角色视角
    UI  NarrativeBeat / media        表现计划

角色可以误解世界，表现可以隐瞒情绪，但二者都不能反向改写 L0。

### 2.4 世界时间和系统时间分离

GameMoment 表示世界因果时间；createdAt、租约和重试时间表示系统运行时间。世界推进不得由墙钟时间暗中替代。

### 2.5 热路径有预算，冷路径可恢复

对话、移动、观察和确定性互动属于玩家热路径。记忆整合、CIF 演化、章节评估和世界模拟通过 DurableJob 异步执行，并具备去重、租约、重试和失败记录。

### 2.6 Expand → Migrate → Contract

跨模块迁移先增加新接口和兼容适配，再迁移调用方，最后收紧旧接口。不得以平台化为由进行 Big Bang 重写。

## 3. 当前架构

    Web UI
      |  PlayerAction / RawPlayerInput
      |  PlayerVisibleState / NarrativeBeat / SSE
      v
    API and Projection
      |
      v
    CommandGateway
      |
      v
    GameRuntime
      |-- Observation --> AgentRunner / Pi adapter
      |                         |
      |<------ AgentAction -----|
      |
      |-- PendingTurnCommit --> SQLite transaction
      |                           |-- world snapshot
      |                           |-- event history
      |                           |-- CIF evidence
      |                           |-- action receipt
      |                           +-- durable jobs
      |
      +-- committed events --> plugins / projection / SSE

CordisPlatformAdapter 负责当前进程内插件的组合和生命周期。系统插件提供状态、持久化、命令、地图、导航和任务能力；功能插件处理场景、互动、剧情、世界模拟、记忆和 CIF 演化。

## 4. 目标分层

    Application / Reference Game
                 |
    Presentation and Projection
                 |
    World and Domain Packages
                 |
    Capability and Plugin Runtime
                 |
    Agent and Character Services
                 |
          Runtime Kernel
                 |
    Persistence and Infrastructure

依赖方向总体向下。下层不得认识具体 Fate 内容、页面框架或模型供应商。

### 4.1 Runtime Kernel

目标职责：

- action admission；
- command routing；
- authority validation；
- session operation queue；
- transaction and rollback；
- idempotency；
- event commit and publication。

Kernel 不应直接实现 Battle、Chapter、Story Summon、角色设定或 SQLite 细节。

当前状态：Transitional。GameRuntime 已正确拥有幂等、顺序、回滚、事件和提交，但仍直接包含战斗、章节进入、角色引入、导航和部分场景规则。

### 4.2 Protocol

Protocol 定义可序列化的 Action、Observation、AgentAction、Command、GameEvent、State、错误、ID 和时间类型。

当前状态：Transitional。核心对象已经存在，但集中在 src/core/contracts.ts，并混合了 Kernel 与 Battle 等领域类型。

### 4.3 Capability 与 Plugin Runtime

插件是 Capability Provider，不只是代码目录。它必须声明 ID、版本、配置版本、依赖、提供能力、事件和 Job 所有权。

当前状态：Implemented v1 / Target v2。

v1 已支持：

- 重复插件和能力检查；
- 缺失依赖、循环依赖和 system scope 检查；
- 依赖顺序挂载；
- register、enable、disable、unregister；
- provider 被依赖时的停用保护；
- Cordis effect 清理和启动失败回滚。

v2 目标：

- capability 版本和 schema；
- apiVersion、权限和稳定 PluginSetupContext；
- 本地插件发现与配置持久化；
- 插件迁移、Job 所有权版本和可诊断来源；
- 公共插件 API 不暴露 Cordis。

### 4.4 Agent Runtime

Agent 是根据 Observation 产生 AgentAction 的执行提供者，不等同于角色实体，也不拥有世界写权。

当前状态：Transitional。Runtime 依赖 AgentRunner 接口，Pi 已被放在适配层；但角色到 Runner 的绑定仍由 Runtime 直接持有，尚无 AgentRegistry、RuleBasedProvider 和独立 ModelProvider 边界。

### 4.5 Character Identity Framework

CIF 维护角色长期主体性：

- identity；
- evidence and knowledge；
- episodic memory；
- belief and interpretation；
- relationship；
- emotion and goals；
- context selection。

History 是客观发生，Memory 是角色记得什么，Belief 是角色如何理解。三者不可合并。

当前状态：Implemented core / Capability boundary available。Context Builder、初始化、L1、L2、受控发布和 L3 修订路径已有测试；`feature.character-cif` 已把 context、memory、identity、epistemic 和 interpretation 注册为五个只读公共 capability，且不向 feature/agent 暴露具体 SQLite 仓储。

### 4.6 World 与 Domain

世界包目标结构：

    World Package
      |-- lore
      |-- characters
      |-- story
      |-- map
      |-- rules
      +-- default plugins

当前 story chapters、story summon、scene lifecycle、interaction coordinator、world simulation、world map 和 navigation 已有插件化实现。Runtime 内仍有兼容领域分支，因此 Domain Extraction 尚未完成。

### 4.7 Persistence

持久化负责世界快照、事件、角色认知、行动收据、任务和迁移。具体数据库连接不得成为公共协议。

当前状态：Implemented SQLite v1 / Target ports and migration framework。

当前 TurnCommit 已将世界快照、客观事件、CIF 反馈、分支投影、任务调度、附加效果和幂等记录置于同一事务。缺少独立 EventStore、SnapshotStore、MigrationRegistry、schema_migrations 和插件数据迁移策略。

### 4.8 Projection 与 Presentation

前端只负责输入、只读投影和渲染。它不能直接读取数据库或裁决行动结果。

当前状态：Implemented vertical slice。HTTP/SSE、PlayerVisibleState、NarrativeBeat、确定性 renderer、播放队列和文本回看已存在；地图、档案、角色面板、正式存读档和完整视觉小说表现仍待完成。

## 5. 标准执行流

1. 前端提交 RawPlayerInput 或 PlayerAction。
2. 输入解释器只产生候选 PlayerAction。
3. Runtime 检查身份、请求指纹、会话状态和行动规则。
4. 需要角色响应时，Runtime 构造经过可见性过滤的 Observation。
5. Agent Provider 返回台词和行动请求。
6. Runtime 将请求规范化为 Command 或领域请求并再次校验。
7. Domain Capability 计算候选结果，但不直接提交。
8. Runtime 形成 PendingTurnCommit。
9. 持久化事务原子写入 State、GameEvent、幂等收据和 Jobs。
10. 事务成功后发布事件、更新只读状态和前端投影。

任何一步失败都不得把临时状态暴露给订阅者。

## 6. 当前实现基线

以下结论以 2026-08-19 的代码、模块边界检查和 104 项通过测试为依据。

| 领域 | 状态 | 证据边界 |
| --- | --- | --- |
| Action / Observation / AgentAction / Event | Implemented v0.2 | src/core/contracts.ts 与 Runtime tests |
| Runtime 幂等、会话串行、回滚、TurnCommit | Implemented | runtime.test.ts、turn-commit.test.ts |
| Plugin manifest、依赖图、生命周期 | Implemented v1 | src/platform 与 platform.test.ts |
| CommandGateway 和 system-only commit | Implemented first boundary | system command/persistence tests |
| SQLite 世界、事件、CIF、Job | Implemented v1 | repository、persistence、durable job tests |
| CIF 初始化、L1/L2/L3 与 Context Builder | Implemented core | src/cif 与相关 feature tests |
| 章节、召集、场景、互动、世界模拟 | Implemented vertical slices | src/story、src/plugins/feature tests |
| 确定性战斗 | Implemented prototype | Runtime battle tests |
| HTTP/SSE 与叙事投影 | Implemented vertical slice | API、SSE、renderer tests |
| Protocol v0.3、Capability v2、SDK、Plugin Host | Target | 尚无对应稳定公共实现 |
| 外部插件、跨进程 Provider、Marketplace | Future | 不属于 v0.3 前置能力 |

该表描述“存在可验证路径”，不代表相应领域已经达到产品完备度。

## 7. v0.3 架构完成条件

v0.3 的主题是 Runtime Platformization。完成时至少满足：

- 公共 Protocol 可独立序列化、版本化且不依赖 Cordis、Pi 或 SQLite；
- Runtime Kernel 不包含具体 Fate、章节、召集或战斗实现分支；
- Capability 支持版本要求、scope 和兼容性检查；
- 公共 Plugin API 不暴露 Cordis Context；
- Pi 和规则 Agent 可通过配置替换，Runtime 无需修改；
- CIF 通过 character capability 访问，不向调用方暴露 SQLite repository；
- 持久化具有稳定 ports、schema version 和 migration registry；
- correlation、replay、plugin swap、agent swap 和架构边界测试通过；
- 至少一个参考插件可仅依赖 SDK 开发和测试。

## 8. 长期目标

### v0.4 Living World

在现有最小 WorldTick 和 durable simulation 基础上，补齐世界时钟、受影响实体规划、离场角色日程、动态剧情响应和预算控制。

### v0.5 External Ecosystem

增加版本化远程能力协议、外部进程健康检查、超时、背压、权限代理和 Unity/Godot 等适配边界。

### v0.8 SDK Stabilization

冻结公开 API、兼容性矩阵、开发者工具、迁移文档和发行流程。

### v1.0 Stable Runtime Platform

开发者可以安装 Runtime，选择 World、Character、Combat、Agent 和 Renderer，在不修改 Kernel 的情况下启动一份完整游戏。

## 9. 架构决策约束

以下变化必须先形成 ADR：

- 改变 Runtime 的世界事实权威；
- 允许功能插件获得通用数据库或提交权限；
- 改变事件不可变性或回放模型；
- 改变世界时间语义；
- 引入进程外插件或不受信任代码；
- 破坏现有存档、事件或 Plugin v1 的兼容读取。

## 10. 相关文档

- [API 与协议规范](../specifications/API_SPECIFICATION_V0.3.md)
- [开发路线与任务拆解](../development/DEVELOPMENT_ROADMAP_AND_TASK_BREAKDOWN.md)
- [当前实现状态](../current-status.md)
- [模块治理](../module-governance.md)
- [插件协议 V1](../plugin-protocol-v1.md)
- [CIF 项目适配](../reference/CIF-v0.2-adaptation.md)
