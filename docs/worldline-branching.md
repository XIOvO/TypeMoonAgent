# 原作参考与玩家世界线

原作资料用于角色初始化、知识边界与章节因果参考；玩家世界线才是游戏中的真实事实。原作不会覆盖已经确认的玩家事件。

## 已实现的第一阶段

- `session_story_contexts`：每个存档的玩家、原作锚点与可恢复检查点版本。
- `branch_facts`：由 L0 已确认事件投影出的关键世界事实。
- `branch_progress`：主线、活动、幕间或原创内容的实际进度；支持 `assumed`、`active`、`completed`、`diverted`、`blocked` 等状态。
- `worldline_divergences`：原作基线与玩家现实的关键差异，并区分已知影响和待进入相关章节后再评估的影响。
- `BranchWorldlineProjector`：只按程序配置的规则处理确认事件，并与回合提交处于同一事务；不由模型自行判定重大偏离。
- `StoryChapterPackageService`：进入章节时保存该章节包；运行时只读取当前激活章节的规则。任何新特异点、活动或幕间都复用这一机制。

新演示存档默认采用 `fgo:chaldea:arrival` 作为原作锚点。已有存档不会被覆盖。

## 尚未实施

- 让玩家在前端选择起始特异点、手动存档和恢复点。
- 第一批冬木/迦勒底的章节规则与原作因果节点配置。
- 首次进入章节时生成局部因果包，以及 `eligible / blocked / diverted` 的后续导演逻辑。

`src/story/content/fuyuki-validation-package.ts` 是一个非常小的机制验证包：它不代表完整冬木剧情，也不会被演示存档自动载入或注册到默认章节目录。真实章节包必须绑定 `lore.sqlite` 中可解析的原作片段。

## 复杂因果评估任务

`chapter.assessment` 复用通用持久化队列。战斗结束、关键物件交互等确认事件会投递任务；Worker 读取活动章节包、实际 Atlas 原作片段、L0 事件和现有分支事实。Pi 的固定提示词只能提交带事件 ID 与原作片段 ID 的草案，程序拒绝未知引用、凭空事实和未支持的章节推进。

## 章节入口 API

前端只能发起选择，不能直接修改进度或世界线：

```text
GET  /sessions/:sessionId/chapters?playerId=:playerId
GET  /sessions/:sessionId/chapters/current?playerId=:playerId
POST /sessions/:sessionId/chapters/enter
```

进入请求：

```json
{
  "playerId": "player",
  "packageId": "validation:fuyuki:v1",
  "mode": "new"
}
```

`mode` 可为 `new`、`resume` 或 `assumed_start`。当前阶段中 `new` 与 `assumed_start` 都激活所选章节包；两者在“此前章节的 assumed 进度”和场景初始化上的差异，会由下一阶段的章节目录与开局配置补齐。`resume` 绝不重置已完成节点或世界状态。

在这些剧情配置到位前，系统只保存世界线与检查点，不会自动假定任何原作事件必然发生。

## 通用剧情召集节点

主线与活动共用 `StoryChapterPackage`。任意节点可声明 `summon`，指定开场角色与原因；章节进入时或后续每次 `wait`，系统只会为当前活跃节点投递一个耐久 `story.summon` 任务。角色同场时由 Runtime 请求受限开场；异地时仅沿普通地图路径移动一格，抵达后的下一 tick 再开场。

成功开场会与 `character_spoke` 一起写入 `story_summon_opened`。章节投影只接受配置相符的该事件推进节点，因此主线、活动、幕间与原创内容都使用同一套“玩家选择进入 → 节点召集 → 权威事件推进”流程。召集不会绕过战斗、角色存在、地图或路径限制；远程通讯、特殊能力与自动登场留待后续能力扩展。
