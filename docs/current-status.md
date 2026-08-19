# 当前实现状态（MVP 垂直切片）

本项目当前不是完整游戏，而是一个已经连通关键边界的 **最小可用垂直切片**。它的目的，是先证明“玩家输入、受限角色 Agent、世界裁决、事件持久化、CIF、原作资料检索”可以安全地协同，而不是提前实现全量 FGO、全战斗或完整叙事编辑器。

## 总体设计

```text
                           本地 Web 前端
                                  │
                       PlayerAction（对话 / 行动 / 战斗意图）
                                  ▼
                         HTTP API + SSE 事件流
                                  ▼
┌──────────────────────────── GameRuntime ────────────────────────────┐
│ 校验输入、构造 Observation、规则结算、可见性过滤、生成 GameEvent      │
└───────────────┬───────────────────────────────────────┬─────────────┘
                │ Observation                           │ 原子提交
                ▼                                       ▼
      Pi Character Agent                         game.sqlite
      （仅表达/申请）                     世界快照、事件、CIF、草案
                │ AgentAction
                └─────────────────────────► Runtime

Atlas 原始 Script → lore.sqlite（切片 + FTS）→ CIF 初始化证据包
                                            └→ 后续角色/剧情检索
```

## 已实现

| 层 | 已完成内容 | 当前边界 |
| --- | --- | --- |
| 游戏协议 | `PlayerAction`、`Observation`、`AgentAction`、`GameEvent` | 顶层支持对话、开放行动、战斗意图 |
| Runtime | 对话、移动、观察、等待；已发布角色的受控引入；事件可见性；回合事务；回滚 | 自由行动 Resolver、物品与战斗规则尚未实现 |
| Pi | 角色回合 Pi 适配器；仅开放 `submit_game_action` | 正式模型运行需用户配置 provider/model/key |
| CIF | 身份、证据、认识、解释模型、即时状态；最小 Context Builder；L1 场景记忆整合与独立 L2 提示词规范 | L2 Worker、信念更新策略与更多触发类型仍待实现 |
| 持久化 | SQLite 世界快照、客观事件、CIF、幂等记录与事务；记忆任务的领取、租约回收与退避重试 | migration 框架、通用 Job / Outbox 与更多 Worker 类型待补 |
| 前端 | 玩家可见状态、SSE 事件流、统一输入；`NarrativeBeat` 协议、确定性 Renderer、播放队列、逐字显示、文本回看与浏览器本地播放恢复 | 尚无地图/档案/角色面板/存读档等功能覆层，且未有最终 Galgame 视觉呈现 |
| 原作资料 | 冬木主线 31 Script → 55 切片；独立 `lore.sqlite` + FTS5 | 未做向量化；仅导入冬木；说话者 ID 映射待补 |
| CIF 初始化 | 时间线过滤的证据包、Pi 低频草案、引用校验、待审核草案、审核后发布、最小审核面板 | 完整审阅编辑与真实开局创建流程仍待实现 |
| 剧情触发 | `CharacterAvailability` 候选池、世界状态过滤、权重排序、Runtime 受控引入 | 尚未接入实际开局创建/存档流程；候选配置目前仅有玛修样例，无 `CanonBeat` 或世界时间推进 |
| 场景互动 | 场景生命周期、同场候选协调、互动计划、执行单状态机、`interaction.execute` 耐久 worker | 玩家输入入口尚未迁移为“先建执行单再异步执行”；当前普通对话仍保留同步兼容路径 |

## CIF 首次登场的实际流程

```text
CharacterIntroductionRequest
  → Lore 过滤（region / war / maxQuestId）
  → CifInitializationBrief（短摘录 + Source Chunk ID）
  → PiCifDraftGenerator（低频、无状态修改权限）
  → CifDraftService（draft / invalid）
  → 人工批准
  → CifInitializationPublisher（published）
  → 正式 CIF + character_introduced 客观事件
```

发布器不会让角色自动出现在场景中；角色可见性仍应由 `GameRuntime` 的未来“角色引入”操作决定。

## 当前可运行案例

```text
npm.cmd test                    # 核心、CIF、资料库、发布器测试
npm.cmd start                   # 本地观测终端；未配置模型时使用演示玛修
npm.cmd run import:atlas:fuyuki # 下载/更新冬木原始 Script
npm.cmd run index:atlas:fuyuki  # 建立 lore.sqlite FTS 索引
```

## 接下来最值得做的四项

1. **开局创建流程接线**：确定性 Story Trigger 已可让已发布玛修在迦勒底大厅登场；下一步是在新存档创建/开局信息确认后发送该信号。
2. **自由行动 Resolver**：让开放自然语言行动可在地点、对象与能力限制下形成确定性事件。
3. **地图与档案投影**：补玩家可见地点状态、地图覆层，以及档案与角色面板的最小投影契约，不暴露隐藏信息。
4. **按需世界推进**：在现有持久化记忆任务模式上增加受预算控制的 `WorldTick` / `SimulationJob`，先服务少数受影响角色。
5. **章节世界推进**：为冬木先建立少量 `CanonBeat` 与 `WorldBranch`，让偏离原作后危机仍按因果推进。

向量检索、更多章节和完整战斗应在以上循环稳定后再引入。
