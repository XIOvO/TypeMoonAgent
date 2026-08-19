# Atlas 原始 Script 导入（Lore v2）

`npm.cmd run import:atlas:fuyuki` 会从 Atlas Academy 的公开 API 下载中文区 War `100`（特异点 F／燃烧污染都市 冬木）中所有 **主线任务** 引用的完整 Script 文本。

导入结果保存在本地的 `data/atlas/CN/war-100-fuyuki/`：

- `scripts/<scriptId>.txt`：未修改的原始 Script 文本；
- `manifest.json`：任务、阶段、Script URL、来源 SHA-1、本地 SHA-1、体积和导入时间。

默认重跑会保留已下载且有校验记录的文本。需要重新拉取时使用：

```text
npm.cmd run import:atlas:fuyuki -- --refresh
```

该目录被 Git 忽略：它是本地资料缓存，而不是项目源码。后续的切片、全文索引和向量化都应从这些原始文本派生，不能覆盖它们。

## 建立本地检索索引

原始文本下载完成后，运行：

```text
npm.cmd run index:atlas:fuyuki
```

这会创建独立的 `lore.sqlite`，而不是修改游戏存档 `game.sqlite`。当前索引会写入：

- `canon_story_collections` → `canon_locations` → `canon_story_nodes` → `canon_story_phases`：篇章、地点、任务与阶段；
- `canon_documents` → `canon_scenes` → `canon_dialogues`：原始 Script、场景、台词及其原始行号；
- `canon_characters` 与 `canon_scene_characters`：由 `charaSet` 和说话者解析出的角色出场；
- `canon_fragments` 与 `canon_fragments_fts`：从台词派生的可检索片段，保留对应场景、台词 ID 与剧透解锁键。

使用 `LORE_DB_PATH` 可以指定另一个资料库路径。向量化尚未启用；FTS 是默认的零额外模型检索方式。

## 全量原作剧情缓存

下面的命令会下载中文区 Atlas 中带 Phase Script 的主线与幕间任务；它只保存文本 Script，不下载立绘、语音或其他二进制游戏资源。下载器会复用已有文件和 `manifest.json`，中断后可直接重跑：

```text
npm.cmd run import:atlas:canon
npm.cmd run index:atlas:canon
```

第二层“精选活动”由 `config/atlas-curated-events.CN.json` 的 `warIds` 明确指定；当前已包含夏日、主线补充、角色重点与 X 系列活动。第三层活动按角色或活动需要再加入该清单并重跑下载器。可选参数：`-- --region=CN --concurrency=6`；只有需要重新下载 Script 时才使用 `-- --refresh`。全量首次导入应先在独立的 `lore.sqlite` 上运行；完成后命令会输出篇章、任务、场景、台词和检索片段的精确数量。

## 从者档案（英灵图鉴）

从者档案与剧情 Script 分开缓存、但导入同一个 `lore.sqlite`。命令如下：

```text
npm.cmd run import:atlas:servants
npm.cmd run index:atlas:servants
```

它保存 Atlas 中文区 `nice_servant_lore` 中图鉴可见从者的基础身份字段（名称、职阶、属性、CV、画师等），以及每一条英灵资料的原文和解锁条件。表为 `canon_servant_profiles` 与 `canon_servant_profile_entries`；资料原文也会形成可检索片段。语音音频、立绘、战斗资源不会下载。CIF 初始化会先按玩家—角色的羁绊等级筛选：`none` 直接可用，`svtFriendship=N` 仅在羁绊达到 N 后可用；通关、活动和无法识别的复合条件在完整玩家进度表接入前一律保持锁定。

`lore.sqlite` 只存文本、结构和索引。未来的 embedding 应存入独立的 `lore-vectors.sqlite`，视觉资源则保存为文件并由单独的资源索引管理。
