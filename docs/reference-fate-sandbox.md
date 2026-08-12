# 参考项目：fate-sandbox 审阅结论

参考仓库：[Xerxes-2/fate-sandbox](https://github.com/Xerxes-2/fate-sandbox)。审阅日期：2026-08-11。

它是一个以 Pi 为基础、强调确定性结算的 TYPE-MOON 叙事运行时，与本项目在“模型负责意图与文本、引擎负责事实和状态”的原则上高度一致。

## 应借鉴的设计

| 设计 | fate-sandbox 做法 | 本项目的采用方式 |
| --- | --- | --- |
| 原子回合提交 | 先应用领域事件、检查未清义务，再追加回合日志 | 将当前逐事件内存写入升级为 SQLite 事务中的 `TurnCommit` |
| 领域事件工具 | 模型只能调用旅行、伤势、经济、记忆等窄工具 | 继续扩展 `submit_game_action`，不要开放通用状态 patch |
| 可见性投影 | 公共事实、玩家已知和隐藏事实分别投影 | Observation Builder 与前端状态必须分开投影，不能只靠提示词保密 |
| 两阶段模型调用 | Settlement 结算与 Render 叙事分离；可独立重渲染 | 后续将 `AgentAction` / 结算与玩家可见叙事分离，重渲染不能重写事实 |
| 记忆检索 | 先用 actor / 地点 / 关键词 / scope 的结构化过滤 | 为 CIF Evidence / Episodic Record 先实现可解释的 SQL 检索，再考虑向量检索 |
| 状态演进 | Schema、迁移、持久化和恢复独立测试 | SQLite Schema 进入版本迁移体系，不能依赖临时建表 |
| 回滚边界 | 重渲染不重跑结算；回滚恢复匹配快照 | Web 前端后续需区分“重新表达”和“撤销行动” |

## 不直接复用的部分

- 该项目以 Pi 的终端交互和 Extension UI 为中心；本项目目标是 Web 前端，因此不采用其命令/UI 层。
- 本项目以 CIF 的角色认知模型为核心；fate-sandbox 的 GM / 状态设计可作为 Runtime 参考，不能替代 CIF 数据模型。
- 原始代码为 GPL-3.0-or-later；在本项目未决定采用兼容许可前，只借鉴架构与行为，不复制代码或混入其文件。
- 其 `world-data` 是面向非商业同人用途的衍生资料；不能直接作为本项目可发布的资料库。

## 对当前路线的直接影响

下一项 Runtime 工作应为 `TurnCommit`：收集一轮的已裁决领域事件，在单个 SQLite 事务里写入客观 History、状态变更、可见角色的 Evidence 和短期状态。只有事务成功，才向前端广播事件。
