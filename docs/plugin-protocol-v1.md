# 游戏插件协议 V1

## 目标

所有游戏能力，包括事件日志、Runtime、地图和剧情，都以插件提供；插件平台本身亦通过 `PluginPlatform` 隔离，可由 Cordis 以外的实现替换。插件是能力边界，不是绕过世界事实与提交规则的入口。

## 装配模型

`bootstrap(platform, composition)` 是唯一的无业务启动入口。`composition` 列出本次游戏启用的插件；`platform` 负责其生命周期。当前平台是 `CordisPlatformAdapter`，并精确锁定使用 DeepSeek Harness 发布的 `@deepseek-ai/cordis`。游戏协议不暴露其类型，因此以后可替换平台或固定自己的 fork。

## 插件声明

每个插件同时提供 Cordis 实现和游戏元数据：`id`、`version`、正整数 `configVersion`、所需 capability、提供 capability、拥有的事件与 durable job 种类。能力以稳定游戏 ID 表示，并映射到平台服务键。能力默认公开；标为 `system` 的能力只能由 `system.*` 插件依赖，装配前会拒绝普通功能插件越权请求。

启动前必须拒绝重复插件 ID、重复 capability、缺失 capability 与非法配置版本。第一版采用静态 composition；不装载陌生代码、不支持运行中替换权威插件。

## 权威写入

插件只能读取其获准能力，并向 `world.commandGateway` 提交命令。一次 composition 中恰有一个 `system.command-authority` 实现负责验证、幂等与原子提交。插件不得直接产生已确认世界事实或直接写持久层。

## 事件与生命周期

- `world/*`：提交后的持久事实；可驱动投影、剧情和耐久任务。
- `command/*`：命令执行过程；不进入世界历史。
- `runtime/*`：平台与诊断事件；不进入世界历史。

插件通过平台 effect 注册监听器、worker、定时器及服务。卸载会撤销这些注册。持久任务后续必须带有 `ownerPlugin`、`ownerVersion` 和 `payloadVersion`，以支持存档诊断和迁移。

## 当前边界

`system.durable-jobs` 是首个已迁移系统插件，提供 `world.jobs` 和 `world.eventTasks`。它保留现有 SQLite 队列、幂等键、租约、重试和事务语义；任务类型与 worker 仍由后续 feature 插件逐一接管。

`system.persistence` 提供只读的 `world.eventHistory`，以及仅供系统层装配 Runtime 的 `system.turnCommitter`。后者保留原有的单事务语义：世界快照、客观事件、角色证据、剧情投影、任务登记、附加提交效果和幂等记录必须一起成功或一起回滚。普通 feature 插件不得请求提交端口；它们后续只读取历史或经命令网关提交请求。

`system.world-state` 提供 `world.state`。它只暴露隔离的已提交世界快照与订阅；本阶段 `GameRuntime` 仍保有唯一写权，并且仅在持久化事务成功后发布快照。因此提交失败、临时变更和回滚均不会泄漏给插件观察者。

`system.command-authority` 提供 `world.commandGateway` 并依赖 `world.state`。当前由既有 `GameRuntime` 作为兼容实现，但 API 已仅依赖网关契约；后续插件只能提交该网关允许的命令，不能取得 Runtime 或持久层的直接写入权。

世界状态内部存储仍在 Runtime 中，待命令权威层完成下一阶段下沉后再移交，避免本阶段形成双写源。

地图 M1 已迁移：`system.world-map` 将当前已提交的 `locations/exits` 暴露为 `world.map`，`system.world-navigation` 以稳定的 `已抵达 / 可达路线 / 不可达原因` 结果提供 `world.navigation`。Runtime 的跨地点接近命令现已经由导航端口取得下一步，仍只提交一条合法出口边。该阶段保持原有排序 BFS 与存档格式，不包含正式地图的层级、通行条件、成本、迷雾或 UI。

`feature.world-simulation` 提供 `world.simulation`，拥有 `world.tick` 与 `world.simulation` 任务。它把已确认的等待事件转换为可重试的 NPC 候选，并仅通过 `world.commandGateway` 请求同场开场或跨地点接近；它不直接写入位置、事件或剧情。插件卸载只停止调度与 worker，已持久化任务会在下次启动恢复。

`feature.story-chapters` 提供 `world.storyChapters`：主线与活动内容都通过同一个“目录 → 新开/续玩 → 命令网关确认进入”的入口。它保留章节包、存档上下文与分支投影的原子写入边界；插件不解释或重写分支规则。

`feature.story-summon` 提供 `world.storySummon`，拥有 `story.summon` 耐久任务。章节进入或时间推进只会排入可重试的召集任务；worker 根据当前已激活章节，在同场时请求角色行动、异地时请求一步接近。它只能调用 `world.commandGateway`，不能直接移动角色、写事件或推进分支。卸载会撤销事件调度与唤醒器，未完成任务仍可在下次启动恢复。

`feature.memory-consolidation` 提供 `world.memoryConsolidation`，拥有 `memory.l1` 耐久任务。CIF 热路径仍在确认事件的同一事务内记录证据、关闭场景窗口和创建任务；功能插件只负责领取、调用无数据库权限的生成器、校验来源并写入角色记忆与 GM 安全投影。它不拥有世界事实写权，也不处理 L2 人格/关系推断。

`feature.cif-patterns` 提供 `world.cifPatterns`，拥有 `memory.l2` 与 `memory.l2.audit` 耐久任务。每条成功的 L1 记忆会排入一个 L2 尝试；生成 worker 至少收集到两条不同的活跃场景记忆后，才允许模型给出关系解释、可错信念或重复目标的候选，并要求引用本次触发记忆。结果先冻结为带校验错误和来源的草案；审核 worker 再把同一草案交给无数据库权限的审核 AI。程序只接受带触发记忆、至少两条来源、理由、策略版本的审核结论，且只有低风险批准可进入发布器。审核失败只重试审核，绝不重新生成或直接改写 live CIF、角色目标、外观因子或身份段落。

`feature.cif-publication` 提供 `world.cifPublication`，是当前 L2 与未来 L3 草案的唯一受控发布入口。审核、拒绝和发布分为不同阶段：审核 AI 不具备写入权限，发布器每次重新读取已批准草案，并与审核结论和任务完成放在同一事务中，追加带版本和来源的 live 关系/信念，或受限地合并重复目标。读取层只取同一命题或同一社交对象的最新版本，避免旧判断与新判断同时进入角色上下文。

CIF/记忆、API 和战斗仍是既有实现，后续只通过协议能力逐项替换。章节包存取暂以受限的原始依赖注入给两个故事插件；下一阶段会抽成只读章节上下文能力，不会赋予 feature 通用仓储写权。
