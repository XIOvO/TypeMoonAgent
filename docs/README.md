# Agent Game Runtime 文档索引

## 核心工程文档

当前工程由三份核心文档共同定义，不再由一份总纲同时承担架构、接口和任务计划。

| 文档 | 唯一职责 |
| --- | --- |
| [架构总览](architecture/overview.md) | 项目定位、不可破坏的原则、当前与目标分层 |
| [API 与协议规范 v0.3](specifications/API_SPECIFICATION_V0.3.md) | 公共对象、模块接口、版本和兼容规则 |
| [开发路线与任务拆解](development/DEVELOPMENT_ROADMAP_AND_TASK_BREAKDOWN.md) | Epic、最小任务、依赖、交付物和验收 |

阅读顺序：先读架构总览，再按需要进入 API 规范或开发路线。

## 权威与状态

1. 已实现事实以代码、测试和 [当前实现状态](current-status.md) 为准；
2. 长期架构原则以架构总览为准；
3. v0.3 公共目标以 API 与协议规范为准；
4. 工程顺序和完成条件以开发路线与任务拆解为准；
5. 专题文档补充领域细节，不得绕过核心文档定义的权威边界。

API 规范中的 Target 和路线图中的待办项均不表示当前代码已实现。较早文档中的“下一步”若与核心路线冲突，以新路线为准。

## 当前状态与治理

| 文档 | 用途 |
| --- | --- |
| [当前实现状态](current-status.md) | MVP 垂直切片的事实快照 |
| [v0.3.0 候选发布审计](development/V0.3.0_RELEASE_CANDIDATE_AUDIT.md) | DoD/M0.3.4 逐项证据、发布阻塞与下一 Gate |
| [项目结构](project-structure.md) | 当前目录和模块导航 |
| [模块治理](module-governance.md) | 新代码归属和依赖方向 |
| [性能预算](performance-budget.md) | 热路径、冷路径和资源预算 |
| [项目设计与开发总纲 V1](project-design-development-v1.md) | 2026-08-19 前的合并总纲，保留为历史基线 |
| [旧整体架构](../AGENT_GAME_ARCHITECTURE.md) | 早期整体设计背景 |
| [架构 V0.2](architecture-v0.2.md) | 持久角色、CIF、Pi、事件与前端的上一版整合架构 |

## Runtime 与公共边界

| 文档 | 用途 |
| --- | --- |
| [核心数据契约 v0.2](contracts.md) | 当前消息与事件示例 |
| [Runtime 规则](runtime-rules.md) | 权威状态、校验与裁决规则 |
| [插件协议 V1](plugin-protocol-v1.md) | 当前插件能力、组合和写入边界 |
| [Plugin Developer Quickstart](sdk/quickstart.md) | SDK Alpha 示例、首个插件和本地验收流程 |
| [持久化基础](persistence-foundation.md) | 召回、写入、事务和任务底层契约 |
| [游戏时间](game-time.md) | GameMoment 与时间推进规则 |
| [玩家输入管线](player-input-pipeline.md) | Raw input 到 Runtime action 的边界 |
| [工具策略](tool-policy.md) | Agent 工具、安全和审计要求 |

## Character、CIF 与 Lore

| 文档 | 用途 |
| --- | --- |
| [Agent 编写规范](agent-authoring.md) | 角色 Agent 资料和提示词规则 |
| [CIF 项目适配](reference/CIF-v0.2-adaptation.md) | 上游快照、版本指纹和本项目适配边界 |
| [CIF 集成](cif-integration.md) | CIF 与 Runtime、Pi、数据库的映射 |
| [CIF 初始化](cif-initializer.md) | 证据包、草案、审核与发布 |
| [角色初始化](character-initialization.md) | 首次登场的官方资料和时间线流程 |
| [事件与记忆](event-and-memory.md) | 事件日志、记忆写入和压缩 |
| [检索策略](retrieval-policy.md) | Lore、Knowledge、Memory 的权限和检索 |

## World、Story 与 Gameplay

| 文档 | 用途 |
| --- | --- |
| [地图与导航](map-and-navigation.md) | 地点模型、导航能力和阶段实现 |
| [场景互动](scene-interaction.md) | 场景生命周期和互动执行 |
| [剧情触发](story-triggers.md) | 确定性剧情触发规则 |
| [角色登场](character-introduction.md) | 受控角色引入 |
| [世界线分支](worldline-branching.md) | 原作参考与玩家世界线 |
| [战斗参与](battle-participation.md) | 指挥、委托和快速结算 |
| [回合类型](turn-types.md) | 对话、行动和战斗 lane |

## Frontend 与表现

| 文档 | 用途 |
| --- | --- |
| [前端协议](frontend-protocol.md) | 玩家输入、投影和状态同步 |
| [前端设计方案](frontend-design-plan.md) | 视觉小说主舞台和功能覆层 |
| [立绘与表情系统](portrait-expression-system.md) | 图集、情绪映射和回退 |

## 历史实施材料

[实现蓝图](implementation-blueprint.md)、[旧交付路线图](delivery-roadmap.md) 和 [项目工作计划](project-work-plan.md) 记录了垂直切片建设过程。它们仍可用于追溯设计动机，但不再作为当前 v0.3 的任务权威。
