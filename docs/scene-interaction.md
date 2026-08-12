# 场景对象与自由互动（MVP）

自由行动不穷举“推门、轻推门、踢门”等表述；它们由输入层归并到少量通用意图，再根据场景对象数据结算。

```text
玩家行动候选
  -> intent: inspect / interact
  -> targetId: 场景对象
  -> Runtime 校验地点与可见性
  -> 结构化 GameEvent 与对象状态更新
```

## 当前对象模型

每个 `SceneObject` 具有：

- `id`、`kind`、`locationId`、`visible`、`tags`；
- 可选的 `inspectText`；
- 可选的结构化 `state`，例如门的 `open` 与 `locked`。

这不是动作清单。相同的 `interact` 在不同对象上由对象状态决定结果。

## 当前规则

| 输入 | 结果 | 谁能获得细节 |
| --- | --- | --- |
| `inspect(targetId)` | `object_inspected`，返回对象检查描述与标签 | 仅执行者 |
| `interact(targetId, method: open/close)` 对门 | 校验锁定/开闭状态，更新 `state.open`，产生 `object_interacted` | 场景内所有可见者 |

不可见、异地或不存在的对象不会被模型“猜出来”，而是明确拒绝。后续可在同一模型上添加容器、装置、物品、机关与线索条件，不需增加新的 LLM 调用。
