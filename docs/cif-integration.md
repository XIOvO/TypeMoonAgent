# CIF v0.2 与 Agent Game 的映射

本项目采用 [XIOvO/CIF-Framework 的 CIF v0.2](https://github.com/XIOvO/CIF-Framework/blob/master/docs/CIF-v0.2.md) 作为角色建模规范。CIF（Character Identity Framework）不是单一的角色档案模板，而是一条从客观世界到角色行动、再到长期发展的完整人物运行链。

```text
External Reality
  → Cognitive Representation
  → Identity and Orientation
  → Event Response
  → Feedback and Development
```

## 系统职责映射

| CIF 层 | Agent Game 中的归属 | 数据与更新方式 |
| --- | --- | --- |
| World State / Objective Information / History | Game Runtime、WorldState、Event Log | Runtime 权威写入；History 追加式保存 |
| Evidence Records | 角色可见事件、即时观察、经历、证言、学习材料 | Observation Builder 生成；重要记录追加保存 |
| Epistemic State | 角色对命题的接受、怀疑、否定与置信度 | 版本化修正，不能改写事实 |
| Interpretive Models | Belief Model、Social Model | 版本化修正，带支持/反对证据 |
| Identity and Orientation | Self Model、Core Schemas、Needs、Values、Possible Selves、Dreams、Commitments | 慢速版本化，不由普通单次互动直接改写 |
| Event Response | Appraisal、Emotion、Goal Formation、Practical Judgment、Intention / Plan、Expression Filter | 本回合状态转移；由 Pi 基于 CharacterContext 推演 |
| Feedback and Development | 新事件造成的新证据、认知与身份变化 | Runtime 先记 History，冷路径再按时间尺度整合 |

## Pi 的准确职责

Pi 不保存或裁决世界，也不应该一次性“生成整个人物”。它运行 CIF 的当前回合认知响应：

```text
Observation
+ 相关 Evidence / Episodic Records
+ 当前 Epistemic State
+ 激活的 Belief / Social Model
+ Identity and Orientation
→ Appraisal
→ Emotion
→ Candidate Goals
→ Practical Judgment
→ Intention / Plan
→ Expression Filter
→ AgentAction
```

Pi 的内部推理不必原样展示或完整持久化；Runtime 应保存可复用且可追溯的结构化结果，例如行动、重要情绪变化、目标结果及其来源事件。

## 数据库模型修正

此前的 `Memory / Knowledge / Belief / Relationship` 分层保留，但必须按 CIF 的精确边界补全：

```text
objective_history             客观事件；全局权威、追加式
character_evidence_records   某角色接触到什么；不代表相信
character_epistemic_states   角色认为命题是否成立；含置信度与证据
character_beliefs             一般化解释模型；含支持/反对证据
character_social_models       对特定人物/群体的理解与预测
character_identity_models     Self Model、Core Schemas、Needs、Values 等
character_commitments         长期责任、关系与选择
character_episode_records     角色亲历的、带主观体验的经历
character_runtime_states      注意、情绪、活跃目标、意图、计划、表达策略
```

- **Evidence 不等于 Knowledge**：听到某个说法应先存为证据，而非直接变为事实或知识。
- **Episodic Record 不等于 Objective History**：角色经历可保留主观感受和错误理解；客观事件不能因此被改写。
- **Belief 不等于 Epistemic State**：前者是一般规律与解释模型，后者是对具体命题的当前判断。
- **Expression 不等于 Emotion / Intention**：角色可以感到委屈却保持平静，也可以想挽留却只说祝福。

## 首次登场时的 CIF 基线

自动初始化应创建的是 **CIF 基线快照**，而不是把所有资料写成通用人格段落：

```text
角色变体 + 剧情时间点 + 来源片段
  → Identity and Orientation baseline
      Self Model / Core Schemas / Needs / Values
      Possible Selves / Dreams / Commitments
  → 初始 Epistemic State / Belief / Social Model（仅限该时间点可知）
  → 初始 Character Runtime State（登场地点、当前处境、短期目标）
  → character_introduced GameEvent
```

官方人物资料应进入 Identity、Knowledge 或初始认知模型；除非游戏明确继承某段已发生经历，否则不应伪造为本 Session 的 Episodic Memory。

## 更新节奏

| CIF 内容 | 更新方式 |
| --- | --- |
| History、Objective Information、重要 Evidence、已执行行动 | 立即追加，通常不需要 LLM |
| Observation、Emotion、当前 Goal、Intention、Expression strategy | 本回合临时状态转移 |
| Epistemic State、Social Model、Belief | 由重要新证据触发，版本化更新 |
| Self Model、Core Schema、Needs / Values、Dreams / Commitments | 长期、重大且可追溯的经历后才更新，优先审核 |

这正是“实时记录 + 延迟整合”的依据：模型只在必须解释或更新角色主观结构时介入；客观事件首先由 Runtime 确认并写入。
