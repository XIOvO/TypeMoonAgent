# Lore 驱动的首次登场 CIF 初始化器

`CifInitializer` 只完成第一步：把角色名、变体、首次登场环境与允许的原作时间线，转换为一组可追溯的原作证据。它不直接写角色数据库，也不自动调用模型。

```text
CharacterIntroductionRequest
  → Lore 搜索（region / war / maxQuestId 过滤）
  → CifInitializationBrief（短摘录 + Script Chunk ID + 缺口）
  → 可配置模型生成 CifInitializationDraft
  → validateCifInitializationDraft
  → 保存为 draft / invalid
  → 程序策略检查（未来可接入独立 AI 审核）
  → 后续发布器写入 CIF repository
```

## 为什么分两步

- Lore 只给出证据；它不推断人格。
- 模型只生成草案；没有证据的段落必须留空或标记复核。
- 校验器会拒绝无来源或引用不存在片段的结论。
- 原作文本不是本局记忆：初始化时不得把它写入 `character_evidence_records`。

## 时间线边界

目前 `canonScope` 支持按 `region`、`warId` 和 `maxQuestId` 过滤。对冬木这样的按任务顺序推进的章节，`maxQuestId` 能阻止之后任务的文本进入首次登场资料包。未来 `src/story/` 建立 `storyPoint → allowed quest/script` 映射后，应改用更严格的白名单，而不是仅依赖任务 ID 顺序。

## 下一阶段

## 已实现的低频草案层

`PiCifDraftGenerator` 是独立于正常角色回合的 Pi worker。它只拥有 `submit_cif_initialization_draft` 工具：不能读写文件、数据库或游戏状态，也不能发布角色。

`CifDraftService` 会把其结果写入 `cif_initialization_drafts`：

- 引用合法且满足最低基线：由程序自动批准并发布；不足或冲突的草案保持隔离，不让角色进入游戏；
- 无来源或越界引用：状态为 `invalid`，保留错误原因；
- 后续独立审核可将状态改为 `approved`、`deferred` 或 `rejected`，但**批准本身仍不写正式 CIF**。

## 已实现的发布器

`CifInitializationPublisher` 只接收状态为 `approved` 且校验仍通过的草案。它会在一个 SQLite 事务中：

1. 以新版本写入 `IdentityModel`；
2. 写入初始知识、关系解释模型与运行态；
3. 追加 `character_introduced` 客观事件；
4. 将草案状态更新为 `published`。

它不改 `GameState`，因此“角色什么时候对玩家可见、何时进入场景”仍必须由 Runtime 决定。未审核、无效或来源越界的草案会被拒绝。

## 本地观测面板

观测终端底部的“首次登场档案”面板只用于开发期观测和诊断：

1. 输入角色名、角色 ID 与允许的最大任务 ID，查看原作证据包；
2. 在配置 `PI_PROVIDER` 与 `PI_MODEL` 后，明确点击“生成待审草案”；
3. 查看草案的来源、校验结果和自动发布状态。

生成草案是系统或开发期诊断主动触发的低频模型调用；未配置模型时 API 返回 `cif_draft_model_not_configured`。发布只写 CIF，不让角色自动出现在当前场景。
# CIF 初始化与 L3 修订提示词

首次登场走“资料 → CIF 初始化提示词 → AI 草案 → 程序验证 → 自动发布或隔离”链路。资料默认来自时间线过滤后的 Atlas / 原作库；若确需外部资料，检索器必须先将来源 URL、摘录、时间线范围和可靠性转成同样的受审计证据条目。模型本身不拥有联网工具，也不能把未附来源的常识写入 CIF。

初始化提示词只能输出现有数据库可承载的字段：`IdentityModel` 的 14 个 CIF section（其中 `character_brief` 是玩家可见的角色总览）、初始知识、初始社会关系、即时状态与审核标记。唯一规范词表是：`character_brief`、`self_model`、`core_schema`、`needs`、`values`、`possible_self`、`dream`、`commitment`、`appraisal_tendencies`、`emotional_pattern`、`practical_judgment`、`expression_filter`、`voice_embodiment`、`growth_boundaries`。每一项人格/知识/关系主张都必须引用 `sourceChunkIds`，发布器才会写入 CIF 表。

当前 `character_identity_models` 是“按 section 存行”的规范化表，因此 `character_brief` 不需要新增一个并列 SQL 列：它以 `section = "character_brief"`、`content`、`source_ids_json`、`version` 的方式持久化，可与其他 CIF section 一样被检索、版本化和投影到前端。

`docs/character-initialization.md` 与运行时均以这 14 项为唯一 section 词表；外部事实、能力、生活上下文与客观关系不属于 `IdentityModel`，将在独立表中持久化，避免把“角色知道/相信什么”混入客观资料。

L3 提示词不初始化角色，而是以多个 L1 场景记忆为证据，对既有 CIF 提出版本化修订草案。每项修订至少引用两条不同的 `EpisodeMemory`，只能微调已经存在的 CIF section；不会直接写库，必须经过独立 AI 审核、程序策略检查和发布步骤后才可生效。
