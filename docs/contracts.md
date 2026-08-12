# 核心数据契约

## 通用规则

- 所有消息必须包含 `schema_version`、`id`、`session_id`、`created_at`（ISO 8601 UTC）。
- ID 使用 UUID 或可追溯的唯一 ID；不得以显示文本作为 ID。
- 枚举字段使用稳定 machine value（如 `dialogue`），显示文案由前端映射。
- 未识别字段应忽略并记录告警；必填字段缺失则拒绝处理。
- 任何状态变化均以 Runtime 产生的 `GameEvent` 为准。

## PlayerAction

玩家提交的意图，不代表该行为已经发生。

```json
{
  "schema_version": "1.0",
  "id": "pa_…",
  "session_id": "session_…",
  "created_at": "2026-08-11T10:00:00Z",
  "actor_id": "player_1",
  "type": "dialogue",
  "content": "玛修，我们去食堂吧。",
  "target_ids": ["mash"],
  "parameters": {"destination": "cafeteria"},
  "client_context": {"scene_id": "chaldea_hall"}
}
```

规则：`actor_id` 必须是当前认证玩家；`client_context` 仅作提示，Runtime 必须自行验证。

## Observation

Runtime 为某一个 Agent 组装的受限视角。它不是完整世界状态。

```json
{
  "schema_version": "1.0",
  "id": "ob_…",
  "session_id": "session_…",
  "created_at": "2026-08-11T10:00:01Z",
  "recipient_id": "mash",
  "trigger_action_id": "pa_…",
  "scene": {"id": "chaldea_hall", "visible_entities": ["player_1", "mash"]},
  "incoming_action": {"actor_id": "player_1", "type": "dialogue", "content": "玛修，我们去食堂吧。"},
  "self_state": {"mood": "calm", "current_goal": "assist_player"},
  "relationship_summary": {"player_1": {"trust": 0.72, "summary": "可靠的前辈"}},
  "constraints": ["不得声称不可见或未知的事实"]
}
```

规则：Observation 只包含角色看得见、被告知或依法可知的信息；秘密、未来剧情与其他角色私有状态必须在构造时移除。

## AgentAction

Agent 的提议，不可直接写数据库或改变客观状态。

```json
{
  "schema_version": "1.0",
  "id": "aa_…",
  "session_id": "session_…",
  "created_at": "2026-08-11T10:00:02Z",
  "actor_id": "mash",
  "observation_id": "ob_…",
  "type": "respond_and_move_request",
  "utterance": "好的，前辈。我陪您一起去。",
  "requests": [{"type": "move", "actor_id": "mash", "destination": "cafeteria"}],
  "confidence": 0.88
}
```

规则：`utterance` 是角色表达；`requests` 是等待 Runtime 裁决的请求。禁止发送 `set_world_state`、任意 SQL 或未经授权的角色/物品修改请求。

## GameEvent

Runtime 确认的事实。事件追加写入，不就地修改历史事件。

```json
{
  "schema_version": "1.0",
  "id": "ge_…",
  "session_id": "session_…",
  "created_at": "2026-08-11T10:00:03Z",
  "sequence": 184,
  "type": "character_moved",
  "visibility": {"scope": "scene", "entity_ids": ["player_1", "mash"]},
  "causation": {"player_action_id": "pa_…", "agent_action_id": "aa_…"},
  "payload": {"character_id": "mash", "from": "chaldea_hall", "to": "cafeteria"},
  "state_revision": 219
}
```

规则：`sequence` 在会话内单调递增；`state_revision` 对应事件应用后的状态版本；需要更正时追加 `event_corrected`，保留原始记录。
