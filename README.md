# Agent Game Runtime

当前核心工程文档为 [架构总览](docs/architecture/overview.md)、[API 与协议规范 v0.3](docs/specifications/API_SPECIFICATION_V0.3.md) 和 [开发路线与任务拆解](docs/development/DEVELOPMENT_ROADMAP_AND_TASK_BREAKDOWN.md)。MVP 实现事实见 [当前状态](docs/current-status.md)，完整专题索引见 [docs/README.md](docs/README.md)。

一个以 **Pi Agent SDK** 为唯一 Agent 接入层的事件驱动游戏后端骨架。

```text
PlayerAction → GameRuntime → Observation → PiAgentRunner
             ← GameEvent  ← AgentAction  ← Pi tools / MCP
```

当前实现的是首个垂直切片的核心：内存 Runtime、事件序列、幂等 PlayerAction、角色 Observation、AgentAction 校验，以及可替换的 Pi Agent Runner；同时已有 SQLite CIF 仓储、CharacterContext Builder 与原子 `TurnCommit` 的第一版。

## 本地运行

1. 配置模型凭据（Pi SDK 可使用它支持的环境变量或凭据配置）。
2. 安装依赖：`npm.cmd install`
3. 校验骨架：`npm.cmd test`

本地查看界面：`npm.cmd start`，然后打开 `http://127.0.0.1:3000`。未设置 `PI_PROVIDER` 与 `PI_MODEL` 时，界面使用明确标记的演示角色；设置它们后将使用 Pi Agent。可选环境变量：`PI_API_KEY`、`GAME_DB_PATH`、`PORT`。

Pi 的真实模型调用尚未连接到 HTTP 服务；`PiAgentRunner` 已提供安全的工具集合和接口位置，下一步是添加 API 与持久化存储。

项目规范见 [docs/README.md](docs/README.md)。

SDK Alpha 插件开发请从 [Plugin Developer Quickstart](docs/sdk/quickstart.md) 开始。
