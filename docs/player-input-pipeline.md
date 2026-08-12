# 玩家输入解释管线

玩家写下的原始文本不是直接的世界事实。系统将其分为：

```text
RawPlayerInput
  -> PlayerInputInterpreter
  -> ParsedPlayerIntent
  -> PlayerAction（玩家尝试）
  -> Runtime 结算后的 GameEvent（客观事实）
```

## 当前 MVP

`DeterministicPlayerInputInterpreter` 不调用模型：当 UI 已明确提交 `dialogue`、`action` 或 `combat` 时，它直接转换为 `PlayerAction`，成本为零。

新 API 也接受 `RawPlayerInput`：

```json
{
  "id": "...",
  "sessionId": "demo",
  "actorId": "player",
  "mode": "auto",
  "content": "我向玛修点头说我没事，同时偷偷观察那扇门。"
}
```

在未配置自由文本解释器时，`mode: "auto"` 返回 `422 ambiguous_freeform_input`。这是一项有意的安全边界：它不会把动作或内心想法伪装成公开台词。

## 已接入：Pi 自由文本解释器

默认的高效路径改为 `PiAgentRunner.runCombined()`：同一次角色 Pi 调用同时提交玩家解释候选与角色回应候选。它保留 CIF 角色上下文，但角色回应只能依据公开台词与可见行动尝试，不能依据私人想法。

如果目标角色不支持合并回合，API 才回退到独立的 `PiPlayerInputInterpreter`，随后按原有方式调用角色 Agent。这让普通社交回合维持一次模型调用，同时保留复杂系统的兼容路径。

- 公开台词在 Runtime 确认后成为 `player_spoke`；
- 行动必须继续经过规则结算；
- 内心想法已与公开文本分离，写入 `player_private_notes`，不会传入 NPC Observation 或客观事件；
- 模糊内容应返回澄清请求或保守的行动候选。

因此只有混合自由文本才增加一次解释模型调用；明确的界面操作仍保持零额外模型成本。
