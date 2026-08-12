# Agent Game 规范索引

这些文档把 [整体架构](../AGENT_GAME_ARCHITECTURE.md) 转化为实现与内容编写时可检查的规则。

| 文档 | 用途 |
| --- | --- |
| [contracts.md](contracts.md) | 核心消息与事件的数据契约 |
| [runtime-rules.md](runtime-rules.md) | 权威状态、校验与裁决规则 |
| [agent-authoring.md](agent-authoring.md) | 角色 Agent 的资料与提示词编写规则 |
| [retrieval-policy.md](retrieval-policy.md) | Lore / Knowledge / Memory 的检索与权限策略 |
| [event-and-memory.md](event-and-memory.md) | 事件日志、记忆写入与压缩规则 |
| [tool-policy.md](tool-policy.md) | MCP 工具接口、安全与审计要求 |
| [frontend-protocol.md](frontend-protocol.md) | 前端交互与状态同步协议 |
| [performance-budget.md](performance-budget.md) | 热路径、冷路径和资源预算 |
| [implementation-blueprint.md](implementation-blueprint.md) | Pi Agent 接入、模块拆分、最小数据模型、接口与首个垂直切片 |
| [delivery-roadmap.md](delivery-roadmap.md) | 分阶段开发顺序与验收条件 |
| [architecture-v0.2.md](architecture-v0.2.md) | 持久角色、CIF、Pi Agent、GM、事件与前端的整合架构 |
| [character-initialization.md](character-initialization.md) | 角色首次登场时的官方资料、时间线与 CIF 自动初始化流程 |
| [cif-integration.md](cif-integration.md) | CIF v0.2 与 Runtime、Pi、数据库的精确映射 |
| [reference-fate-sandbox.md](reference-fate-sandbox.md) | fate-sandbox 可借鉴架构、差异与许可边界 |

实施顺序：先完成 `contracts`、`runtime-rules` 与 `agent-authoring`，随后按 `implementation-blueprint` 的首个垂直切片开发，并以 `delivery-roadmap` 验收。
