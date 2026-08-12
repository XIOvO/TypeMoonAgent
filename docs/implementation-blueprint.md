# 实现蓝图（Pi Agent 接入）

本文将架构与规范拆成可独立开发、替换和测试的模块。Agent 接入固定使用 Pi Agent SDK；前端、数据库与部署方案可以后续选择，但模块边界不应改变。

## 模块边界

```text
Web Client
    │ HTTP / WebSocket
    ▼
API Gateway
    ├── Session & Identity
    ├── Action Controller
    └── Event Stream
             │
             ▼
Game Runtime ── Pi Agent Runner ── Pi Model Runtime / Model Provider
    │                 │
    │                 └── Tool Gateway ── Retrieval Service
    │                                      ├── Memory Store
    │                                      ├── Knowledge Store
    │                                      └── Lore Store
    ├── State Repository
    ├── Event Repository
    └── Cold-path Queue ── Memory / Summary / Director Workers
```

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| API Gateway | 认证、输入校验、提交 Action、推送事件 | 裁决游戏规则 |
| Game Runtime | 规则、事务、状态、事件、可见性 | 自由生成角色台词 |
| Pi Agent Runner | 组装 Observation、以 Pi SDK 调用模型与受控工具、校验 AgentAction | 权威状态写入 |
| Tool Gateway | Agent 身份、工具授权、审计、限流 | 让工具绕过 Runtime 改状态 |
| Retrieval Service | 权限过滤、召回、重排、引用来源 | 决定世界事实 |
| Cold-path Workers | 记忆、摘要、索引、背景模拟 | 阻塞玩家当前响应 |

## 最小数据模型

以下为关系型数据库的概念模型。向量索引可独立部署，但必须以条目 ID 关联回权威元数据。

```text
sessions(id, state_revision, world_time, status, created_at)
characters(id, template_version, …)
session_characters(session_id, character_id, location_id, state_json, …)
events(id, session_id, sequence, type, payload_json, visibility_json,
       causation_json, state_revision, created_at)
processed_actions(action_id, session_id, result_event_ids, created_at)
knowledge_entries(id, content, metadata_json, visibility_json, …)
memories(id, owner_id, session_id, event_ids_json, summary, salience,
         metadata_json, embedding_version, created_at)
jobs(id, type, idempotency_key, payload_json, status, attempts, …)
```

要求：

- `events(session_id, sequence)` 唯一，且 sequence 不可回退。
- `processed_actions(action_id)` 唯一，用于 PlayerAction 幂等。
- `session_characters` 与 `sessions.state_revision` 的更新必须与事件写入同一事务完成。
- 向量检索命中后，必须回查 Knowledge / Memory 的权限元数据再返回结果。

## 服务接口

### 玩家接口

```text
POST /sessions/{sessionId}/actions
  请求体：PlayerAction
  返回：accepted（含 action_id）或输入/权限错误

GET /sessions/{sessionId}/state?after_revision={n}
  返回：完整快照或可见状态增量

WS /sessions/{sessionId}/events
  推送：当前用户可见的 GameEvent、处理状态与可恢复错误
```

### Runtime 内部接口

```text
handle_player_action(action) -> ActionResult
build_observation(session, recipient, trigger) -> Observation
validate_agent_action(action, observation) -> ValidatedRequest[]
resolve_requests(requests, state) -> GameEvent[]
```

接口返回错误时使用稳定错误码，不把模型供应商、数据库或内部提示词错误直接暴露给前端。

## 一次行动的事务边界

1. 检查 `processed_actions`：若已存在，返回其已有结果。
2. 读取 session 的当前 revision，并进行必要的并发控制。
3. 执行确定性前置校验；不可执行的行动直接形成拒绝结果。
4. 调用 Pi Agent（如本轮需要），并验证其工具提交的输出契约。
5. 裁决所有允许的请求。
6. 单一事务内写入 events、状态更新、`processed_actions` 与冷路径 job。
7. 事务成功后推送事件；推送失败可由事件流重放补齐。

模型调用在事务外进行；最终写入前必须重新确认 state revision 或按照冲突策略重新裁决。

## 首个垂直切片

先实现“玩家与一个角色在一个场景中对话，并一起移动到另一个地点”：

1. 创建 session、玩家、角色、两个地点。
2. 接收 `dialogue` 与 `move` PlayerAction。
3. Runtime 构造角色 Observation。
4. Agent 返回对白和可选移动请求。
5. Runtime 校验通路、角色是否在场、目的地是否可达。
6. 追加 `character_spoke`、`character_moved` 等事件。
7. 前端从事件流展示对话与地点变化。
8. 后台将重要对话生成角色记忆。

这条切片跑通前，不加入战斗、多人即时调度、完整世界导演或全量设定库。
