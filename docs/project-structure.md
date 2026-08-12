# 项目目录与模块边界

```text
agent game/
├─ src/
│  ├─ app/             # 组合应用：启动、依赖装配、演示世界
│  ├─ core/            # 纯游戏内核：协议、Runtime、AgentRunner 边界
│  ├─ agents/          # 外部 Agent 适配器：Pi 角色回合与低频 CIF 草案，未来 GM / Renderer
│  ├─ cif/             # CIF v0.2：角色上下文、初始化材料、提示词、反馈、SQLite CIF 仓储
│  ├─ lore/            # 原作资料：Atlas 导入、Script 切片、SQLite FTS 检索
│  ├─ persistence/     # 持久化提交边界与未来 migrations / repository ports
│  ├─ api/             # HTTP、SSE、玩家可见状态投影
│  └─ index.ts         # 可被其他程序导入的公共出口
├─ public/             # 纯前端静态资源，不直接访问数据库
├─ scripts/            # 可重跑的离线任务：Atlas 下载、未来切片/索引/迁移
├─ data/               # 本地资料缓存（Git 忽略）
│  └─ atlas/           # 原始 Atlas Script 和导入 manifest
├─ docs/               # 架构、协议、内容制作、运行与资料策略
├─ AGENT_GAME_ARCHITECTURE.md  # 初版架构蓝图（历史总览）
├─ README.md           # 安装与快速运行
└─ package.json        # 命令与依赖
```

## `src` 的依赖方向

```text
app ──► api ──► core
app ──► agents ──► core / cif
app ──► persistence ──► cif
cif ──► core（只读取 GameEvent / Observation 类型）
```

`core` 不依赖 Pi、HTTP、前端、Atlas 或 SQLite 的具体实现；这是后续替换模型、增加 Resolver 或测试规则的基础。

## 未来模块落点

| 能力 | 目录 | 首个职责 |
| --- | --- | --- |
| 自由行动结算 | `src/action/` | `ActionResolver`、对象能力、检定与可见结果 |
| 战斗 | `src/combat/` | 战斗状态机、资源、时序、确定性事件 |
| 章节推进 | `src/story/` | 当前确定性 Story Trigger；未来 `CanonBeat`、`WorldBranch`、世界压力推进 |
| 原作资料库 | `src/lore/` | 文档/切片仓储、FTS、来源引用、权限过滤 |
| 叙事表现 | `src/narrative/` | `NarrativePreset`、模板 Renderer、可选模型 Renderer |
| 数据库演进 | `src/persistence/migrations/` | schema version、升级与备份策略 |

这些目录在对应能力真正开始实现时再创建，避免现在放置空壳文件。

## 数据边界

- Git 包含：源码、schema/migration、下载/索引脚本、文档和小型演示数据。
- Git 不包含：`*.sqlite`、`data/atlas/` 原文、向量索引、本地模型、密钥。
- 原始 Script 永不由 AI 覆盖；切片、FTS、CIF 证据和 CanonBeat 都是可重建的派生数据。
