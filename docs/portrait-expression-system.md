# 角色立绘与表情系统约定（暂定）

## 目标

让前端以低资源开销切换 FGO 风格全身立绘的表情，同时避免根据图像尺寸猜测切片位置。

本约定以 Atlas Academy 的 `CharaFigure` 图集和 `svtScript` 定位数据为输入。它适用于前端呈现，不参与 Runtime 的世界裁决。

## 核心结论

- `*_merged.png` 是一个合成图集：上部为全身立绘画布，下部为可替换的脸部表情格。
- 表情格在全身画布中的目标位置不能从图像本身可靠推断。
- Atlas 的 `svtScript` 返回 `faceX`、`faceY`、`offsetX`、`offsetY` 等定位数据；这些数据才是合成依据。
- `svtScript` 不包含“高兴、愤怒、害羞”等情绪语义。情绪映射必须由本项目人工维护。

## 资源模型

每个可渲染的立绘由 `figureId + form` 唯一确定。

```text
PortraitKey
  figureId: number      # 例如玛修的 98001000
  form: number          # 再临、灵衣或多形态编号；默认 0
```

所需资源：

```text
图集：      /CharaFigure/{figureId}/{figureId}_merged.png
定位数据：  /raw/{region}/svtScript?charaId={figureId}
```

资源导入时应缓存图集和定位 JSON；前端运行时只从本项目资源服务读取它们。不要让每次切换表情都重新下载图集。

## 通用 PortraitComposer

前端渲染器接收 `PortraitKey`、表情格编号 `faceIndex` 和已缓存的图集／定位数据，输出 Canvas 或等效图层。

默认合成流程：

1. 选取与 `form` 匹配的 `svtScript` 记录。
2. 绘制图集上方的全身画布（常规规格为 `1024 × 768`）。
3. 按 `offsetX`、`offsetY` 移动全身画布。
4. 根据表情格尺寸和 `faceIndex` 计算图集下方的源矩形。
5. 在 `(faceX - offsetX, faceY - offsetY)` 清除旧脸区域，并绘制新脸。
6. 仅清除目标区域内部边缘；保留少量抗锯齿过渡像素，避免出现接缝。

默认脸格为 `256 × 256`，但实现必须优先处理：

- `extendData.faceSize`
- `extendData.faceSizeRect`
- 多个 `form` 各自的 `faceX`、`faceY` 和偏移

不能假设所有图集都拥有相同的行数、脸格尺寸或形态数。

## 情绪协议

角色逻辑只应给出稳定的情绪键，前端负责解析为该角色可用的表情格。

第一版词表：

```text
neutral
speak
smile
surprised
serious
angry
sad
worried
hurt
embarrassed
thinking
tearful
```

建议的前端输入：

```ts
type PortraitExpressionRequest = {
  characterId: string;
  figureId: number;
  form: number;
  emotion: string;
};
```

情绪不是 Runtime 的权威世界状态；它是当前一句台词或叙事节拍的呈现提示。前端可在没有新提示时保持上一张脸。

## 人工映射表

每个 `figureId + form` 必须单独维护映射。不要把“第 3 格”等同于某一固定情绪，也不要跨角色复用格号。

```json
{
  "figureId": 98001000,
  "form": 0,
  "faces": {
    "0": ["neutral"],
    "3": ["surprised"],
    "7": ["serious"],
    "10": ["worried"],
    "12": ["smile"],
    "13": ["smile"],
    "14": ["embarrassed"]
  }
}
```

上例仅展示数据结构，格号与情绪必须经过人工目检后才可写入正式资源库。

一个表情格可以对应多个情绪键；一个情绪也可以有多个候选格。后者可在将来加入权重或随机选择，但第一版应保持确定性。

## 回退规则

解析优先级：

```text
精确的 figureId + form + emotion
  → 同 figureId + form 的 neutral
  → 同角色指定的默认立绘 neutral
  → 不替换脸部，显示原始全身立绘
```

前端不得因为找不到情绪映射而显示错误角色的表情，也不得把未知情绪硬映射为“生气”等高语义表情。

## 标注工作流

1. 导入单个图集和对应 `svtScript`。
2. 在表情实验页逐格点击，确认全身合成无错位。
3. 标注人员选择零个、一个或多个标准情绪键。
4. 人工复核后将映射写入版本化 JSON。
5. 前端在构建或资源更新时校验：格号存在、`form` 存在、情绪键属于词表。

视觉模型可以提供候选标签，但不能跳过人工复核，也不能把推断结果直接发布为正式映射。

## 玛修验证基线

玛修测试资源：

```text
figureId: 98001000
form: 0
faceX: 384
faceY: 149
offsetX: 0
offsetY: 125
默认脸格: 256 × 256
```

本地验证页：`/expression-lab`。

该页面用于验证合成与人工标注，不代表所有表情已拥有可信的情绪名称。
