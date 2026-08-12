# 前端协议

## 职责

前端负责输入、呈现和本地交互状态；Runtime 是权威状态源。前端不得直接修改游戏数值或调用角色 Agent 绕过 Runtime。

## 通信

- 提交 PlayerAction 后显示 pending 状态，使用 action ID 关联结果。
- 接收 `GameEvent`、`action_rejected`、`state_snapshot` 与 `runtime_error`。
- 事件只渲染其 `visibility` 允许的内容；不要仅依靠 CSS 隐藏秘密字段。
- 断线重连后以 Runtime 的 `state_revision` 拉取增量；版本不连续则请求完整快照。

## 体验规则

- 将“角色正在思考/检索”与“世界已发生变化”清楚区分。
- 网络或模型失败时保留玩家草稿，提供重试，不伪造成功结果。
- 用稳定 ID 去重事件，避免重连后重复展示行动。
