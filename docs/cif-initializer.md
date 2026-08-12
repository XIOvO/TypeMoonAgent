# Lore 驱动的首次登场 CIF 初始化器

`CifInitializer` 只完成第一步：把角色名、变体、首次登场环境与允许的原作时间线，转换为一组可追溯的原作证据。它不直接写角色数据库，也不自动调用模型。

```text
CharacterIntroductionRequest
  → Lore 搜索（region / war / maxQuestId 过滤）
  → CifInitializationBrief（短摘录 + Script Chunk ID + 缺口）
  → 可配置模型生成 CifInitializationDraft
  → validateCifInitializationDraft
  → 保存为 draft / invalid
  → 人工审核
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

- 引用合法：状态为 `draft`，等待人工审核；
- 无来源或越界引用：状态为 `invalid`，保留错误原因；
- 审核可将状态改为 `approved` 或 `rejected`，但**批准本身仍不写正式 CIF**。

## 已实现的发布器

`CifInitializationPublisher` 只接收状态为 `approved` 且校验仍通过的草案。它会在一个 SQLite 事务中：

1. 以新版本写入 `IdentityModel`；
2. 写入初始知识、关系解释模型与运行态；
3. 追加 `character_introduced` 客观事件；
4. 将草案状态更新为 `published`。

它不改 `GameState`，因此“角色什么时候对玩家可见、何时进入场景”仍必须由 Runtime 决定。未审核、无效或来源越界的草案会被拒绝。

## 本地审核面板

观测终端底部的“首次登场档案”面板提供最小审核流程：

1. 输入角色名、角色 ID 与允许的最大任务 ID，查看原作证据包；
2. 在配置 `PI_PROVIDER` 与 `PI_MODEL` 后，明确点击“生成待审草案”；
3. 查看 `draft` 状态的草案并点击“批准并发布”。

生成草案是用户主动触发的低频模型调用；未配置模型时 API 返回 `cif_draft_model_not_configured`。批准后只发布 CIF，不让角色自动出现在当前场景。
