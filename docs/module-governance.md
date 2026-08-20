# 模块治理与文件归属

本文件是新增功能的落点规则。目标是让每项能力只有一个明确的负责人，避免同一份世界状态、业务规则或外部接入在多个目录中并行生长。

## 当前模块

| 模块 | 负责内容 | 可以依赖 |
| --- | --- | --- |
| `protocol`（目标） | 可序列化的 Action、Command、Event、State、ID、时间与错误契约 | 仅 `protocol` |
| `core`（过渡中的 Kernel） | 现有游戏协议、规则结算、`GameRuntime` 与端口类型 | `core`、`persistence`、`protocol` |
| `cif` | 角色认知、初始化、草稿与 CIF 存储 | `core`、`lore`、`cif`、`protocol` |
| `lore` | 原作资料导入、切片、检索与来源 | `lore`、`protocol` |
| `story` | 剧情触发、角色可用性和推荐 | `core`、`cif`、`story`、`protocol` |
| `narrative` | 已确认事件到可播放叙事块的转换 | `core`、`narrative`、`protocol` |
| `persistence` | 事务提交、仓储实现、迁移 | `core`、`cif`、`persistence`、`protocol` |
| `jobs`（未来） | 持久化 Job / Outbox、租约、重试与幂等消费端口 | `core`、`persistence`、`jobs` |
| `agents` | Pi 等外部模型适配器；只能提议，不能裁定世界事实，且不得依赖具体 CIF 仓储 | `core`、`cif`、`agents`、`protocol` |
| `platform`（当前进程内适配器） | 插件组合、生命周期与 Cordis 适配 | `platform`、`protocol` |
| `plugins/system` | 系统 capability provider；不得导入 feature plugin | `cif`、`core`、`persistence`、`platform`、`plugins/system`、`protocol` |
| `plugins/feature` | 领域 capability provider；可读取已声明的 system port，但不得导入其他 feature plugin 或具体 CIF 仓储 | `cif`、`core`、`persistence`、`platform`、`plugins/feature`、`plugins/system`、`protocol`、`story` |
| `api` | HTTP、SSE、玩家可见投影和静态资源服务 | `core`、`cif`、`narrative`、`api`、`protocol` |
| `app` | 组合根：启动、依赖装配、演示世界 | 所有业务模块 |

`src/index.ts` 仅作为对外导出清单，不承载业务逻辑。`public/` 只放浏览器静态资源，`scripts/` 只放可重复执行的离线任务，二者不得直接读写运行时数据库。

## 新功能放置规则

1. 先确定它改变的唯一事实：世界规则进 `core`，角色主观信息进 `cif`，原作资料进 `lore`，呈现文本进 `narrative`。
2. 外部系统（浏览器、HTTP、Pi、SQLite）只能在对应适配层出现；业务模块通过已有类型或端口协作。
3. 一个功能的类型、实现和测试应放在同一模块中；测试文件使用 `*.test.ts` 并紧邻实现文件。
4. 只有 `app` 可以装配具体实现。其他模块不得反向导入 `api`、`app` 或 `agents`。
5. 新增一级模块前，先在本表登记职责、状态所有权、允许依赖和最小测试命令；不要创建空目录占位。
6. 可选能力必须在 `app` 的组合根登记其 `requires`、`provides`、`start`、`stop` 与消费的 Job 类型；能力不能通过监听器或 Worker 绕过 Runtime 写入客观世界状态。

## 自动检查

执行 `npm.cmd run check:modules` 会扫描生产 TypeScript 文件，拒绝未登记的模块及不符合上述依赖方向的相对导入。它会将 `plugins/feature` 与 `plugins/system` 视为独立模块，强制 `protocol` 不依赖实现层，并拒绝 `agent`、`agents` 或 `plugins/feature` 直接导入 `SqliteCifRepository`。它是架构回归检查，不替代类型检查和测试；提交涉及 `src/` 的改动前应依次执行：

```text
npm.cmd run check:modules
npm.cmd test
```

当一项需求必须跨两个模块时，先由拥有状态的模块定义契约，再由上层适配层编排；不要为了方便而建立反向引用。
