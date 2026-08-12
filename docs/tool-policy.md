# MCP 工具规范

## 基础要求

每个工具须定义名称、调用者、输入 Schema、输出 Schema、权限、限流、超时、审计字段和错误码。工具只做一件语义明确的事。

推荐工具：

```text
recall_memory(query)
search_known_facts(query)
search_relationship_history(target, query)
inspect_visible_scene()
request_action(action, target, parameters)
```

## 安全与可靠性

- 工具服务端依据 caller identity 再次授权，不能信任 Agent 声称的角色身份。
- 查询工具默认只读；状态改变一律通过 Runtime 的 `request_action` 进入裁决流程。
- 返回结构化错误：`unauthorized`、`not_found`、`invalid_input`、`rate_limited`、`temporary_failure`。
- 记录调用者、参数摘要、返回条目 ID、耗时和请求 ID；敏感正文不得进入普通日志。
- 任何会产生副作用的工具必须声明幂等键和确认结果。
