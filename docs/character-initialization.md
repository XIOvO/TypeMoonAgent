# 角色首次登场与 CIF 自动初始化

## 目标

当一个角色第一次进入某个游戏 Session 时，系统根据其**官方资料、选择的作品版本、当前剧情时间点与初始场景**，自动创建一份符合 CIF 框架的角色配置。

这解决的不是“把角色百科全文塞进 Prompt”，而是：

> 让同一个角色在不同时间、不同作品阶段、不同世界线登场时，拥有正确的初始人格、知识边界、关系与心理状态。

例如，角色在故事早期登场时不能拥有后期事件塑造出的信念、记忆、关系或秘密知识。

## 总体流程

```text
剧情触发器 / GM 请求
  → resolve_character_variant
  → 官方资料与时间线资料检索
  → 来源和剧透边界过滤
  → CIF Initializer（Pi / 专用初始化模型）
  → 可验证的 CharacterProfileDraft
  → 自动规则检查 + 可选人工审核
  → 写入 Character Profile / State / Knowledge / Relationship
  → character_introduced GameEvent
```

角色在写入成功前不参与正常场景调度；初始化结果随后由 Context Builder 按需读取。

## 1. 角色变体与登场上下文

“角色 ID”不足以决定配置，必须先解析其变体：

```ts
interface CharacterIntroductionRequest {
  sessionId: string;
  canonicalCharacterId: string; // 例如角色的稳定规范 ID
  variantId: string;            // 作品/形态/世界线/职阶等变体
  storyPointId: string;         // 当前明确的剧情时间点
  introductionContext: {
    locationId: string;
    presentEntityIds: string[];
    reason: "story_trigger" | "summon" | "encounter" | "gm_request";
  };
  sourcePolicyId: string;
}
```

`storyPointId` 是剧透控制的关键。它不应只是日期，而应能表达“该角色已经历哪些官方事件、尚未经历哪些事件”。

## 2. Canon Source Pack：来源包而非无边界联网搜索

每个角色变体使用可审计的来源包：

```text
canon_source_packs
  id · canonical_character_id · variant_id · source_policy_id · version

canon_source_fragments
  source_pack_id · fragment_id · source_reference · content
  timeline_start · timeline_end · spoiler_level · reliability · tags
```

来源片段可涵盖官方角色资料、已授权文本摘录、官方剧情摘要、设定集笔记及人工校订摘要。每条资料都必须标记适用时间区间和来源。

不要让初始化器直接无条件抓取 Wiki 或整部原作文本：这会产生错误、版本混杂、剧透与版权风险。优先使用用户提供、可使用或已人工校订的资料；系统保存**来源引用与摘要**，不以复制受版权保护的长文本为目标。

## 2.1 分层取证规则

初始化器不应一次把所有来源混在一起。它按照“先结构化锚点、再社区补全、最后互联网兜底”的优先级获取资料，并保留每项结论来自哪一层。

```text
Layer 1：Atlas Academy / 已接入的结构化 FGO 数据
  ↓ 不足时
Layer 2：已批准的社区资料库（Mooncell、TYPE-MOON Wiki 等）
  ↓ 不足时
Layer 3：受控互联网搜索与官方页面发现
  ↓
Canonical Source Pack（候选）→ 审核 → CIF 基线
```

### Layer 1：结构化游戏资料（优先）

目标是建立稳定的角色与作品锚点，而不是分析人格。

可获取：规范角色 ID、从者/灵衣/职阶变体、名称与别名、游戏内档案/Lore 引用、能力与特性、实装或章节/活动关联、数据版本与区域。

规则：

- 结构化 ID 是后续所有来源的主键；禁止仅凭名称合并角色。
- 区分 JP / NA / CN 等区域版本与数据版本，不把解锁后的资料默认视为初始可知。
- Atlas 资料优先用于实体匹配、变体解析和来源定位；不自动推导人格、信念或关系。
- 原始条目进入 `source_fragment`，并标记获取时间、上游版本和许可/使用条件。

### Layer 2：社区资料库（补剧情语境）

目标是补足角色首次登场时的剧情位置、已发生经历、关键人物关系与术语解释。

规则：

- 只读取被项目列入白名单的站点、页面类型和语言版本。
- 每条片段必须附页面 URL、页面标题、修订时间（可取得时）、角色变体、推断的适用剧情区间与剧透等级。
- 社区资料只能形成 `candidate`；与 Layer 1 或其他来源冲突时，不覆盖结构化事实，而是添加冲突标记。
- 不能从“角色后期总览页”直接导入早期登场状态；必须由 `storyPointId` 过滤。

### Layer 3：受控互联网搜索（兜底）

目标是发现遗漏的官方页面、访谈、角色资料或可用于人工复核的线索，不能作为无来源自动写库器。

规则：

- 查询必须带角色变体、作品和剧情时间点；禁止只搜索角色名后全量抓取。
- 优先官方域名、出版物页面与 Layer 1 / 2 指向的来源；搜索摘要不能当作证据正文。
- 仅保存链接、短摘要、检索日期和用途；长篇受版权保护原文不进入本地资料库。
- Layer 3 单独来源的结论必须标为 `low_confidence` 和 `needs_review`，不得自动发布为 CIF 基线。

## 2.2 资料融合与停止条件

初始化器按字段而非按“整篇角色资料”融合来源。每个字段都必须带 `source_fragment_ids`、`confidence`、`story_point_range` 与 `review_status`。

```text
必需字段：角色变体、登场世界/地点、身份基线、可行动能力边界、知识边界
建议字段：核心价值、当前承诺、关键关系、短期目标、显著情绪压力
可延后字段：核心图式、梦想、复杂社会模型、长期信念细节
```

满足必需字段且不存在高风险冲突时，可以生成 **最低可用 CIF 基线**；未填字段保持未知，不允许模型以套路补全。这样资料不完整时角色仍可登场，并在后续审核或游戏事件中逐步丰富。

以下情况必须停止自动发布并进入审核队列：

- 角色变体或剧情时间点无法唯一确定。
- 来源互相冲突且影响身份、已知事实或关键关系。
- 发现未来剧情/解锁资料可能泄露到当前 `storyPointId`。
- 只有搜索摘要或未验证的社区断言，没有可追溯来源。

## 2.3 推荐的初始化伪流程

```text
resolve_variant(request)
  → Atlas: 获取 canonical ID、variant、基础游戏数据与 Lore 引用
  → build_research_gaps()
  → Community: 只补足剧情阶段、关系、已发生经历等缺口
  → Web search: 仅为未解决缺口寻找可审核来源
  → normalize_source_fragments()
  → filter_by_story_point_and_spoiler_policy()
  → create_CIF_baseline_draft()
  → deterministic_validation()
  → publish 或 needs_review
```

## 3. CIF Initializer 的输入

初始化器只获得经过时间线过滤的资料：

```text
CharacterVariant
+ StoryPoint / Worldline
+ 当前登场地点与人物
+ 可用 Canon Source Fragments
+ CIF schema
+ 初始化约束
→ CharacterProfileDraft
```

必须在提示中约束：

- 只从输入资料归纳，不补写无来源的经历。
- 不把后期事件、未来关系、未揭示真相写入初始 Knowledge 或 Memory。
- 将事实、推测和创作性补全分别标注置信度。
- 人格档案以“倾向、冲突、边界、决策原则”表述，不生成固定台词集合。
- 无法确定的部分留空或标记 `needs_review`。

## 4. 初始化产物

初始化器输出结构化草案，禁止直接写入数据库：

```ts
interface CharacterProfileDraft {
  canonicalCharacterId: string;
  variantId: string;
  storyPointId: string;
  cifSections: Array<{
    sectionType: "core_identity" | "core_needs" | "values" |
      "relationship_beliefs" | "emotional_structure" | "defense_patterns" |
      "social_behavior" | "intimacy" | "self_model" |
      "decision_principles" | "voice";
    content: string;
    sourceFragmentIds: string[];
    confidence: "high" | "medium" | "low";
  }>;
  initialState: {
    mood: string;
    currentGoals: string[];
    locationId: string;
  };
  initialKnowledgeIds: string[];
  initialBeliefs: Array<{ subject: string; proposition: string; confidence: number; sourceFragmentIds: string[] }>;
  initialRelationships: Array<{ targetId: string; summary: string; confidence: number; sourceFragmentIds: string[] }>;
  reviewFlags: string[];
}
```

重要原则：初始资料不是“记忆”。官方背景可进入 CIF / Knowledge；只有角色在当前 Session 已经发生、被告知或明确带入的经历才能进入 Memory。

## 5. 审核与版本策略

自动初始化应先生成草案，再进行两层检查：

1. **确定性检查**：所有 CIF section 是否有来源；资料是否在 `storyPointId` 的允许范围内；目标人物是否已登场；是否含禁止剧透标签。
2. **内容审核**：首次引入重要角色或低置信度草案时，允许作者在后台查看并修改草案后发布。

发布后保存：`profile_version`、`initializer_version`、`source_pack_version`、`story_point_id` 与来源片段 ID。后续发现设定错误时，新建版本或补丁，而不是静默改写历史角色状态。

## 6. 与 Runtime、Pi 和冷路径的关系

```text
首次登场：CIF Initializer 创建初始角色快照
正常回合：Context Builder 取 CIF 片段 + 当前状态 + 检索结果 → Pi
已确认事件：Runtime 写 Event Log
异步整合：Consolidation 更新 Memory / Belief / Relationship / 长期状态
```

CIF 是缓慢变化的人格基础；当前状态、记忆与关系则根据已确认事件逐步演化。除非存在明确、经审核的重大角色转变，不应由每轮冷路径随意重写 CIF。

## 7. MVP 实现顺序

1. 先手工建立一个 `Canon Source Pack` 与一个角色变体，验证字段与时间线过滤。
2. 定义 `storyPointId` 与允许的来源标签。
3. 实现 `CharacterProfileDraft` Schema 与确定性校验器。
4. 用 Pi 运行一次受约束的 CIF 草案生成，保存来源引用。
5. 增加简单审核页或 JSON 审核流程，再写入数据库。
6. 将已发布角色接入 `CharacterContext Builder`。
7. 稳定后批量扩展角色与资料包，而非一开始全自动导入整个世界观。
