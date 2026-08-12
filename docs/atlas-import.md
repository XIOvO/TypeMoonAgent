# Atlas 原始 Script 导入

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

- `script_documents`：来源、章节、任务、Script ID、本地路径和哈希；
- `script_chunks`：约 650 字符的连续可检索文本块；
- `script_chunks_fts`：SQLite FTS5 中文子串检索索引。

使用 `LORE_DB_PATH` 可以指定另一个资料库路径。向量化尚未启用；FTS 是默认的零额外模型检索方式。
