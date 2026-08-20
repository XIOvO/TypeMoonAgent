# Agent Game Runtime 开发路线与任务拆解

> 文档版本：v0.3 Draft
> 文档状态：核心工程文档 / 执行计划
> 基线版本：agent/v0.2-runtime-expansion
> 目标版本：Agent Game Runtime v1.0
> 最近核验：2026-08-19

## 0. 文档职责

本文把 [架构总览](../architecture/overview.md) 和 [API 与协议规范](../specifications/API_SPECIFICATION_V0.3.md) 转换为可执行工程工作。

本文只回答：

- 接下来做什么；
- 按什么依赖顺序做；
- 哪些工作可以并行；
- 每个最小任务交付什么；
- 怎样验证完成。

本文不重新定义 Runtime 权威、公共协议语义或 CIF 理论。

## 1. 规划原则

### 1.1 基线不是空项目

当前代码已经具备：

- PlayerAction、RawPlayerInput、Observation、AgentAction、GameEvent；
- GameRuntime、会话串行、幂等、回滚和 TurnCommit；
- Plugin Manifest v1、依赖验证、Capability v1、PluginManager、Cordis adapter；
- CommandGateway、system-only TurnCommitter；
- SQLite 世界快照、事件、CIF、幂等记录和 DurableJob；
- Pi AgentRunner、CIF Context Builder、L1/L2/L3 演化路径；
- 地图、导航、场景、互动、章节、召集和最小世界模拟插件；
- 确定性战斗原型；
- HTTP、SSE、PlayerVisibleState 和 NarrativeBeat 垂直切片。

2026-08-19 基线：

- npm.cmd run check:modules：127 个 TypeScript 文件通过；
- npm.cmd test：104 项测试通过；
- Git 工作区在文档整理前无未提交变更。

### 1.2 演进方式

后续工作采用：

    Preserve invariants
            +
    Extract interfaces
            +
    Migrate through adapters
            +
    Remove compatibility only after proof

不得把 v0.3 平台化解释为重写全部代码。

### 1.3 任务完成的最低定义

每个 Task 必须有：

1. 唯一 owner 模块；
2. 明确输入、输出和禁止变化；
3. 最小可审查交付物；
4. 成功、拒绝和失败路径中的适用测试；
5. 模块边界检查；
6. 文档状态同步。

## 2. 总版本路线

| 版本 | 主题 | 核心结果 |
| --- | --- | --- |
| v0.3 | Runtime Platformization | 把内部能力变成稳定 Protocol、Capability、Plugin 和 SDK 边界 |
| v0.4 | Living World | 扩展现有 WorldTick 为受预算控制的持续世界模拟 |
| v0.5 | External Ecosystem | 支持跨进程、跨语言和外部引擎 Provider |
| v0.8 | SDK Stabilization | 冻结开发者 API、兼容矩阵、迁移和发行工具 |
| v1.0 | Stable Runtime Platform | 第三方无需修改 Kernel 即可开发并运行完整游戏 |

v0.3 完成前不把以下工作列为主线：

- 全量 Fate 章节和大量角色；
- 完整 FGO 战斗复刻；
- Unity/Godot 正式客户端；
- Marketplace；
- 不受信任远程插件。

## 3. v0.3 目标与 Epic

v0.3 的完成结果是：Runtime 只认识 Action、Command、Event、State、Capability、Agent、Transaction 和 Plugin，不认识具体 Fate、Pi、SQLite、章节或战斗实现。

| Epic | 名称 | 主要输出 |
| --- | --- | --- |
| E01 | Protocol Foundation | 独立、可序列化、可版本化的协议层 |
| E02 | Runtime Kernel Extraction | 通用命令、权威、队列、事务与 facade |
| E03 | Capability & Plugin Runtime v2 | 版本化 capability、稳定 plugin context 和本地 host |
| E04 | Persistence & Migration | 稳定 ports、schema version、迁移框架 |
| E05 | Agent Runtime | AgentRegistry、Pi adapter、Rule Agent |
| E06 | CIF Capability Extraction | character capabilities 和 repository 隔离 |
| E07 | Domain Extraction | 从 Runtime 完成互动、剧情、战斗、导航迁移 |
| E08 | Observability & Architecture Quality | correlation、trace、replay 和边界测试 |
| E09 | SDK & Reference Plugins | SDK Alpha、测试 Runtime 和参考插件 |

## 4. E01 — Protocol Foundation

目标：从 src/core/contracts.ts 抽出稳定公共协议，同时保持 v0.2 JSON 和 Runtime 行为兼容。

最终目录目标：

    src/protocol/
      ids.ts
      time.ts
      action.ts
      observation.ts
      agent-action.ts
      command.ts
      event.ts
      state.ts
      errors.ts
      capability.ts
      index.ts

| Task | 最小实现单元 | 交付物 | 依赖 | 验收 | 并行性 |
| --- | --- | --- | --- | --- | --- |
| E01-01 | 定义品牌化 ID 和 revision/sequence 类型 | ids.ts | 无 | JSON 表示仍为 string/number；类型检查通过 | 可立即 |
| E01-02 | 抽出 GameMoment | time.ts | E01-01 | 现有世界时间测试通过；无 createdAt 因果替代 | 可立即 |
| E01-03 | 迁移 RawPlayerInput、PlayerAction、ParsedPlayerIntent、ActionResult | action.ts + 兼容 re-export | E01-01 | 三个 v0.2 lane 和 auto 解释行为不变 | 可立即 |
| E01-04 | 迁移 Observation 并增加可选 constraints/context refs | observation.ts | E01-01 | 旧字段仍可读；可见性测试通过 | 与 E01-03 并行 |
| E01-05 | 迁移 AgentAction；增加通用 ActionRequest | agent-action.ts + adapter | E01-01、E01-04 | move 请求兼容；未知请求被 Runtime 拒绝 | 与 E01-03 并行 |
| E01-06 | 定义 CommandEnvelope、Result、Rejection、Proposal | command.ts | E01-01 | JSON round-trip；不得含实现句柄 | E01-03 后 |
| E01-07 | 定义 GameEvent v0.3 envelope 和旧事件升级器 | event.ts | E01-01、E01-02 | v0.2 事件可读；schemaVersion/source/correlation 可填充 | E01-03 后 |
| E01-08 | 统一错误码和 ValidationResult | errors.ts | E01-01 | 调用方按 code 分支，不依赖 message | 可并行 |
| E01-09 | 分离通用 State 与 Battle domain 类型 | state.ts + compatibility exports | E01-03、E01-07 | GameRuntime tests 不回归；无存档破坏 | 后置 |
| E01-10 | 建立协议序列化和兼容测试 | protocol.serialization.test.ts、protocol.compatibility.test.ts | E01-01 至 09 | public protocol 全部 round-trip | 收尾 |

E01 完成条件：

- src/protocol 不导入 platform、agents、api、persistence 或领域实现；
- src/index.ts 只 re-export 稳定入口；
- 旧 import 通过兼容 export 暂时工作；
- 不删除 v0.2 事件和存档读取路径。

## 5. E02 — Runtime Kernel Extraction

目标：保留当前正确的会话顺序、幂等、回滚和提交语义，将领域分支移出 Kernel。

| Task | 最小实现单元 | 交付物 | 依赖 | 验收 | 并行性 |
| --- | --- | --- | --- | --- | --- |
| E02-01 | 通用 CommandRouter，按 command type 解析 handler | kernel/command-router.ts | E01-06 | 未注册 command 稳定拒绝；重复注册失败 | E03 capability contract 后 |
| E02-02 | 抽出 RuntimeAuthority | kernel/authority.ts | E01-08 | player、agent、system request 权限测试 | 可与 01 并行 |
| E02-03 | 抽出 idempotency 状态机 | kernel/idempotency.ts | E01-03 | processed、in-flight、指纹冲突和重启测试 | 可与 01 并行 |
| E02-04 | 抽出 SessionOperationQueue | kernel/session-operation-queue.ts | 无 | 同 Session 串行、不同 Session 可并行 | 可立即 |
| E02-05 | 定义 RuntimeTransaction | kernel/transaction.ts | E01-07、E04 ports | 失败不发布 state/event；rollback 测试 | E04 接口后 |
| E02-06 | 增加通用 execute(command) | Runtime facade compatibility layer | E02-01 至 05 | 旧 handle 方法仍工作且转入新路径 | 后置 |
| E02-07 | 收紧 Runtime facade | dispatch、execute、subscribe、getState | E07 完成 | GameRuntime 无领域 handler | 收尾 |

必须保留的现有测试语义：

- action 重放与冲突拒绝；
- 异步失败后下一次提交仍成功；
- agent proposal 校验；
- commit 失败不发布；
- event sequence 和 state revision 连续；
- TurnCommit 原子性。

## 6. E03 — Capability 与 Plugin Runtime v2

目标：把当前可用的 Plugin v1 升级为可版本化、可发现且不暴露 Cordis 的公共插件边界。

| Task | 最小实现单元 | 交付物 | 依赖 | 验收 | 并行性 |
| --- | --- | --- | --- | --- | --- |
| E03-01 | CapabilityDefinition 和 Requirement | protocol/capability.ts | E01-01 | id/version/scope/schema 可序列化 | 可立即 |
| E03-02 | semver compatibility 函数 | platform/capability-version.ts | E03-01 | exact、caret、mismatch 表格测试 | 与 03 并行 |
| E03-03 | CapabilityRegistry | platform/capability-registry.ts | E03-01 | register、resolve、unregister、list | 与 02 并行 |
| E03-04 | Manifest v2 + v1 upgrader | platform/plugin-manifest.ts | E03-01、E01-08 | apiVersion、type、permissions；v1 可读 | 02 后 |
| E03-05 | 稳定 PluginSetupContext | platform/plugin-context.ts | E03-03 | API 无 Cordis 类型；lifecycle effect 可清理 | 03 后 |
| E03-06 | Cordis adapter v2 | platform/cordis-platform.ts adapter | E03-05 | 现有插件 lifecycle tests 继续通过 | 后置 |
| E03-07 | LocalPluginHost | platform/local-plugin-host.ts | E03-04、E03-05 | 只发现受信任本地路径；无 registry | 后置 |
| E03-08 | profile composition schema | config/plugins schema + loader | E03-04、E03-07 | disabled/config/version 解析和拒绝测试 | 后置 |
| E03-09 | plugin state/config persistence | store port + SQLite adapter | E04-01 | 重启保持启用状态和配置版本 | E04 后 |
| E03-10 | Job ownership validation | manifest/worker registration check | E03-04、E04-05 | ownerPlugin/version/payloadVersion 一致 | E04 后 |

v2 回归矩阵：

- missing capability；
- duplicate provider；
- version mismatch；
- dependency cycle；
- system scope violation；
- disable provider with dependent；
- setup failure rollback；
- clean stop/dispose。

## 7. E04 — Persistence 与 Migration

目标：保持当前 SQLite 原子事务，分离公开 ports，并建立可验证迁移。

| Task | 最小实现单元 | 交付物 | 依赖 | 验收 | 并行性 |
| --- | --- | --- | --- | --- | --- |
| E04-01 | 定义 EventStore、SnapshotStore、JobStore、MigrationStore | persistence/contracts | E01-07 | 不暴露 SQL/SQLite；mock 可实现 | 可与 E01 并行 |
| E04-02 | 将现有 repository 包装为各 port adapter | SQLite adapters | E04-01 | 行为与现有仓储测试一致 | 01 后 |
| E04-03 | Migration、Registry、Runner | persistence/migrations | E04-01 | 顺序、幂等、checksum 冲突测试 | 与 02 并行 |
| E04-04 | schema_migrations 表 | SQLite migration store | E04-03 | 新库和旧库升级测试 | 03 后 |
| E04-05 | snapshot/event/job 版本字段 | schema changes + read upgrader | E01-07、E04-03 | old read / current write | 04 后 |
| E04-06 | 验证 Atomic Outbox 边界 | TurnCommit port tests | E04-02、E04-05 | state/events/receipt/jobs 同成同败 | 02 后 |
| E04-07 | 备份、失败恢复和迁移 CLI 设计 | operator contract + dry-run | E04-03 | dry-run 不写库；失败可恢复 | 后置 |

v0.3 不批量重写全部历史事件。默认读取旧形状、内存升级、投影当前形状。

## 8. E05 — Agent Runtime

目标：把角色绑定从 GameRuntime 移到 AgentRegistry，并证明 Agent 不绑定 LLM。

| Task | 最小实现单元 | 交付物 | 依赖 | 验收 | 并行性 |
| --- | --- | --- | --- | --- | --- |
| E05-01 | AgentProvider 和 BindingQuery | agent/provider.ts | E01-04、E01-05 | 可独立 mock；无模型 SDK 类型 | 可并行 |
| E05-02 | AgentRegistry | agent/registry.ts | E05-01 | register、resolve、unregister、not found | 01 后 |
| E05-03 | 角色 agentProfile/tags/providerHint 配置 | binding schema | E05-02 | 不使用角色 ID 硬编码 provider | 02 后 |
| E05-04 | 包装 PiAgentRunner | PiAgentProvider adapter | E05-01 | Pi 安全工具集合与结果校验不变 | 与 02 并行 |
| E05-05 | 实现 RuleBasedAgentProvider | deterministic provider | E05-01 | 无模型凭据可完成参考回合 | 与 04 并行 |
| E05-06 | ModelProvider 最小边界 | agent/model-provider.ts | E05-04 | Runtime 不感知模型供应商 | 04 后 |
| E05-07 | Runtime 迁移到 AgentRegistry | compatibility adapter | E05-02 至 05 | Pi/Rule 仅改配置即可切换 | 收尾 |

## 9. E06 — CIF Capability Extraction

目标：给现有 CIF 增加公共能力接口，不重写已经通过测试的 CIF 模型。

| Task | 最小实现单元 | 交付物 | 依赖 | 验收 | 并行性 |
| --- | --- | --- | --- | --- | --- |
| E06-01 | character.context | CharacterContextProvider wrapper | E03-03 | 现有 Context Builder 输出和预算测试 | 可与 E05 并行 |
| E06-02 | character.memory | recall-only provider | E04 ports | 不暴露 SQLite；owner 隔离测试 | 与 01 并行 |
| E06-03 | character.identity | identity section provider | E04 ports | context tags 和版本读取正确 | 与 02 并行 |
| E06-04 | character.epistemic | EpistemicProvider | E04 ports | known/believed/suspected/unknown 分离 | 与 02 并行 |
| E06-05 | character.interpretation | InterpretiveModelProvider | E04 ports | 只读最新 live 版本 | 与 02 并行 |
| E06-06 | 组合 feature.character-cif | plugin manifest + providers | E03-05、E06-01 至 05 | capability registry 可解析全部能力 | 后置 |
| E06-07 | 隔离 concrete repository import | boundary rule + adapters | E06-06 | feature/agent 不直接 import SqliteCifRepository | 收尾 |

2026-08-20 状态：E06-01 至 E06-07 已完成。`feature.character-cif` 提供五个只读 character capability，v2 平台挂载会把实现注册到 `CapabilityRegistry`；模块边界检查禁止 feature/agent 直接导入 `SqliteCifRepository`。

L1、L2、审核、发布和 L3 仍遵守现有证据与人工/策略门控，不因 capability 化获得直接 live 写权。

## 10. E07 — Domain Extraction

目标：逐个领域迁移，不进行 Big Bang 重构。当前已有的功能插件优先复用和补齐。

### 10.1 Interaction

当前 feature.interaction-coordinator 已拥有协调与执行 Job。

| Task | 最小实现单元 | 交付物 | 验收 |
| --- | --- | --- | --- |
| E07-I1 | 将 world.interactionCoordinator 规范化为 interaction.plan/execute adapter | stable capability facade | 现有协调测试通过 |
| E07-I2 | 玩家普通对话也先建执行单 | API/Runtime migration | 同一 action 不重复计划 |
| E07-I3 | 移除 Runtime 对具体 coordinator 的直接依赖 | command handler | Runtime 只依赖 capability |

2026-08-20 状态：E07-I1 至 E07-I3 已完成。`feature.interaction-coordinator` 提供 `interaction.plan`、`interaction.execute` 和 `interaction.commandHandler` 三个稳定 capability，保留 `world.interactionCoordinator` 作为兼容入口；普通玩家对话会与 `player_spoke` 事件在同一事务中创建唯一的 `interaction.execute` 执行单，再由 worker 经命令网关提交角色回复，动作重放不会重复计划或调用角色代理。Runtime 只依赖 `InteractionCommandHandler` 契约，替换 capability provider 的组合测试已覆盖该边界。

### 10.2 Story

当前 story chapters 和 story summon 已插件化，但 CommandGateway 与 GameRuntime 仍有领域方法。

| Task | 最小实现单元 | 交付物 | 验收 |
| --- | --- | --- | --- |
| E07-S1 | 定义 story.enter、story.evaluate、story.progress commands | story command schemas | 未注册 story capability 稳定拒绝 |
| E07-S2 | 迁移 chapter entry 和 summon 到 handlers | plugin handlers | 现有章节、回滚、召集测试通过 |
| E07-S3 | 将角色引入策略从 Runtime 分离 | story/appearance capability | 未发布角色仍不能引入 |

2026-08-20 状态：E07-S1 至 E07-S3 已完成。`feature.story-chapters` 提供并通过 handler 执行 `story.enter`，`feature.story-summon` 提供并通过 handler 执行 `story.progress`；`feature.story-appearance` 提供 `story.appearance`，拥有角色发布态和可用性的引入策略，并在提交前重新验证。`story.evaluate` 暂不注册，调用会稳定返回 `story.capability_unavailable`。Runtime 保留兼容引入操作，但不再依赖 CIF 发布态策略。

### 10.3 Combat

当前 Runtime 内已有确定性战斗原型，目标是迁移而非新增完整战斗。

| Task | 最小实现单元 | 交付物 | 验收 |
| --- | --- | --- | --- |
| E07-C1 | 定义 combat.resolve capability 和 command schemas | protocol + capability | attack/defend/delegate/quick resolve 可表达 |
| E07-C2 | 把现有 resolver 包装为 SimpleCombatPlugin | reference implementation | 当前 battle tests 原样通过 |
| E07-C3 | 实现 DummyCombatPlugin | swap-test implementation | 替换时 Kernel 零修改 |
| E07-C4 | 删除 Runtime 内具体 battle handler | compatibility removal | Kernel import graph 无 combat implementation |

2026-08-20 状态：E07-C1、E07-C2、E07-C3 已完成。`combat.resolve` 已有 public capability definition 和严格的可序列化 command schema，可表达命令式 attack/defend、delegate 与 quick resolve；`feature.simple-combat` 已注册为 reference provider，并复用 Runtime 的确定性结算入口。`feature.dummy-combat` 以同一 capability 替换 reference provider，验证相同组合仅替换插件即可运行，Kernel 与 Runtime 均无需修改。

### 10.4 Navigation

当前 world.map 和 world.navigation 已存在。

| Task | 最小实现单元 | 交付物 | 验收 |
| --- | --- | --- | --- |
| E07-N1 | 将 player move 统一为 navigation command | handler adapter | 仍只移动一条合法出口 |
| E07-N2 | 删除 Runtime 内 BFS/可达策略知识 | boundary cleanup | Runtime 只使用 navigation result |
| E07-N3 | 增加 provider swap test | alternate map/navigation fixture | 存档事实保持兼容 |

E07 全部完成后，GameRuntime 不得按 battle_started、chapter_entered、story_summon_opened 等领域事件类型实现业务分支。

## 11. E08 — Observability 与架构质量

E08 从 v0.3 第一天开始，不在最后补做。

| Task | 最小实现单元 | 交付物 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| E08-01 | correlationId 生成与传播 | protocol fields + adapters | E01-06、E01-07 | Action 到 Job 可串联 |
| E08-02 | TurnTrace | observability/turn-trace.ts | E08-01 | 记录 IDs/provider/context refs；无 CoT |
| E08-03 | 模块边界检查 v2 | check-module-boundaries rules | 新目录落地 | protocol/kernel/feature/adapter 禁止反向依赖 |
| E08-04 | import graph architecture test | architecture-boundaries.test.ts | E08-03 | CI 可确定性失败 |
| E08-05 | event replay test | replay fixture | E01-07、E04-01 | initial state + events 得 expected state |
| E08-06 | plugin swap test | Simple/Dummy combat fixtures | E07-C2、C3 | Kernel 不变 |
| E08-07 | agent swap test | Pi/Rule binding fixture | E05-05、E05-07 | Runtime 不变 |
| E08-08 | redaction test | trace and projection tests | E08-02 | hidden CIF/CoT 不进入 trace 或 UI |

## 12. E09 — SDK 与参考插件

目标：证明架构可被项目外开发者使用，而不只是内部目录更整齐。

| Task | 最小实现单元 | 交付物 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| E09-01 | SDK public entry | definePlugin、defineCapability、defineEventSchema、defineAgentProvider、defineJobHandler | E03 稳定 | public exports 无 private implementation |
| E09-02 | createTestRuntime | SDK test harness | E02、E04 ports | 不启动 HTTP/SQLite 也能测插件 |
| E09-03 | simple-greeting plugin | examples/plugins/simple-greeting | E09-01、02 | 一条 command/event 闭环 |
| E09-04 | simple-combat plugin | examples/plugins/simple-combat | E07-C2 | 可替换并通过 conformance |
| E09-05 | rule-agent provider | examples/providers/rule-agent | E05-05 | 无模型密钥可运行 |
| E09-06 | Plugin Developer Quickstart | docs/sdk/quickstart.md | E09-03 至 05 | 新开发者按文档完成示例 |
| E09-07 | SDK conformance suite | compatibility tests | 全部 | manifest/protocol/lifecycle/cleanup 通过 |

SDK 第一阶段可位于 src/sdk，达到独立发行条件后再迁移 packages/sdk。目录移动不得先于公共边界稳定。

## 13. 并行 Workstream

| Workstream | 负责 Epic | 冲突热点 |
| --- | --- | --- |
| A — Protocol | E01 | src/core/contracts.ts、src/index.ts |
| B — Kernel | E02 | src/core/runtime.ts、command gateway |
| C — Plugin Runtime | E03 | src/platform/contracts.ts、cordis adapter |
| D — Persistence | E04 | turn commit、SQLite schema |
| E — Agent/CIF | E05、E06 | agent runner、context builder |
| F — Domain | E07 | Runtime compatibility handlers |
| G — Quality/SDK | E08、E09 | boundary checker、public exports |

### 13.1 依赖图

    E01 Protocol
         |
         +----------+----------+
         v          v          v
        E02        E03        E04
      Kernel      Plugin   Persistence
         |          |          |
         +-----+----+-----+----+
               |          |
               v          v
              E05        E06
             Agent       CIF
               +----+-----+
                    v
                   E07
                 Domain

    E08 贯穿全部阶段
    E09 在 E03 公共边界稳定后启动

### 13.2 可以提前并行

E01 的 ID、time 和初始 interfaces 确定后，可以并行：

- SessionOperationQueue；
- Capability Registry；
- Persistence ports；
- Agent Provider/Registry；
- CIF read-only provider wrappers；
- boundary checker 新规则。

### 13.3 必须单一 owner 的文件

- src/core/contracts.ts；
- src/core/runtime.ts；
- src/platform/contracts.ts；
- src/index.ts；
- package.json；
- SQLite schema 和 migration registry。

其他 Workstream 通过 RFC、adapter 或临时 compatibility export 接入，不并发改写同一权威文件。

## 14. v0.3 里程碑

### M0.3.1 — Protocol Freeze Alpha

范围：

- E01；
- CapabilityDefinition / Requirement；
- Manifest v2；
- compatibility tests。

交付：Protocol v0.3-alpha。

门槛：类型、序列化、旧事件/旧输入读取和模块边界通过。

### M0.3.2 — Runtime Decoupling Alpha

范围：

- E02；
- Capability Registry；
- Persistence ports；
- migration registry。

交付：Kernel v0.3-alpha、Plugin Runtime v2-alpha、Persistence Ports v1。

门槛：幂等、并发、回滚、原子提交和 Plugin v1 回归通过。

### M0.3.3 — Agent / CIF / Domain Migration

范围：

- E05、E06；
- Interaction、Story、Combat、Navigation 迁移。

交付：可配置 Agent、CIF capability、可替换 domain providers。

门槛：Pi/Rule swap、Simple/Dummy combat swap、现有章节和 CIF 测试通过。

### M0.3.4 — SDK Validation

范围：

- E08、E09；
- Quickstart、reference plugins、conformance suite。

交付：SDK Alpha、Reference Plugins、v0.3.0 候选。

门槛：replay、swap、migration、architecture CI 和完整测试通过。

## 15. v0.3 Definition of Done

只有全部满足才发布 v0.3：

### Kernel

- 不依赖 TypeMoon、Fuyuki、CanonBeat、具体 Combat 或 Story implementation；
- 只通过 ports 和 capability 调用领域行为；
- 幂等、事务、顺序、回滚语义保持。

### Plugin

- capability 版本和 requirement 可校验；
- Plugin v1 有兼容读取；
- local plugin discovery、enable/disable 和 dispose 可验证；
- 公共 API 不暴露 Cordis。

### Agent 与 CIF

- Pi Agent 和 Rule Agent 仅通过配置切换；
- Runtime 不直接持有 concrete runner map；
- character.context 等能力不暴露 SQLite repository；
- CIF 证据、审核和发布门控不被削弱。

### Persistence

- stable ports、snapshot/event/job schema version 和 migration registry 存在；
- old read / current write；
- state、events、receipt 和 jobs 原子提交。

### Quality 与 SDK

- protocol serialization；
- rollback、idempotency、concurrency；
- replay；
- plugin swap；
- agent swap；
- module boundary；
- SDK conformance；
- reference plugin quickstart。

## 16. v0.4 — Living World

当前已经有由 confirmed wait 调度的最小 WorldTick、候选筛选、同场开场和一步接近。v0.4 在此基础上扩展，不从零重新实现。

| Epic | 内容 | 交付 | 验收 |
| --- | --- | --- | --- |
| W01 World Clock | 多种 TickRequest、预算和暂停策略 | versioned world clock capability | 游戏时间驱动，不使用墙钟替代 |
| W02 Simulation Planner | 受影响实体、优先级、预算、去重 | deterministic planner | 相同输入产生相同 Job 集 |
| W03 Background Character | 日程、目标、移动和简单互动 | bounded character simulation | 离场角色可推进但不越权 |
| W04 Dynamic Story | 事件、时间、状态、角色目标触发 | story reaction capability | 不强制覆盖玩家世界线 |
| W05 Memory Evolution | L1 到 L2/L3 的预算与策略 | evolution scheduler | 失败可重试且不改 live 状态 |
| W06 Observability | 世界推进解释和成本指标 | simulation trace | 能回答为何唤醒、耗时和结果 |

关键验收：玩家不输入内容时，授权的 WorldTick 可以通过 DurableJob 和 CommandGateway 产生可追溯 GameEvent；无任务时世界不得偷偷变化。

## 17. v0.5 — External Ecosystem

| Epic | 最小能力 |
| --- | --- |
| X01 Remote Capability Protocol | handshake、manifest exchange、version negotiation |
| X02 Process Host | health、timeout、cancel、restart、backpressure |
| X03 Permission Proxy | network/filesystem/model/world access enforcement |
| X04 Cross-language SDK | JSON Schema、RPC client、conformance fixtures |
| X05 Engine Adapters | Unity/Godot projection and input adapters |
| X06 Package Integrity | source record、checksum、signature policy |

v0.5 不默认信任远程代码。进程崩溃或 Provider 替换不得损坏 Runtime 状态。

## 18. v0.8 与 v1.0

v0.8 冻结：

- public API surface；
- semver 和 deprecation policy；
- migration guides；
- compatibility matrix；
- plugin diagnostics；
- release and rollback tooling；
- developer documentation。

v1.0 验收：

1. 第三方只使用 SDK 和公开协议；
2. 一个非 TypeMoon 参考世界可以完成对话、移动、互动、战斗、保存和恢复；
3. Agent、Combat、Persistence 和 Renderer 至少各有两个可替换实现或测试替身；
4. Kernel 无需为参考世界增加条件分支；
5. 插件/Provider 失败后世界状态可恢复和解释。

## 19. Issue 模板

每个 Task 拆成 Issue 时使用：

    Title:
    Epic / Milestone:
    Owner module:
    Problem and evidence:
    Behavior contract:
    Inputs / outputs:
    Expected files:
    Forbidden files and changes:
    Dependencies:
    Deliverable:
    Tests and acceptance:
    Migration / compatibility:
    Rollback:
    Residual risk:

一个 Issue 只改变一个行为路径或一个模块边界。若需要同时改变协议、迁移、功能和 UI，应拆成有依赖关系的多个 Issue。

## 20. 合并与发布规则

推荐合并顺序：

1. Protocol；
2. Capability contracts；
3. Kernel compatibility layer；
4. Persistence ports and migrations；
5. Agent Registry；
6. CIF providers；
7. Domain extraction；
8. SDK；
9. compatibility cleanup。

每个合并至少执行：

    npm.cmd run check:modules
    npm.cmd test

涉及存档、事件或 migration 时，必须额外执行 old-read/current-write、失败回滚和备份恢复测试。涉及公开协议时，必须更新本文、API 规范和兼容性记录。

## 21. 当前下一步

E06 已完成，E07-I1 至 E07-I3、E07-S1 至 E07-S3、E07-C1 至 E07-C3 已完成。下一步进入 E07-C4：

1. 删除 Runtime 内的具体 battle handler；
2. 让 combat.resolve provider 成为唯一战斗入口，并保持领域回归通过。

E07 仍采用兼容 adapter 迁移；在领域回归与 swap test 完成前，不删除现有 Runtime 方法。
