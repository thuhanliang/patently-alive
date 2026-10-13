# 002 · 准备美术资源

状态：**待办**　　分支：`human/002-art-assets`　　急不急：**阶段 1 要用**

美术风格已定为"田野笔记"（见 `CLAUDE.md`、`docs/GDD.md` 的美术方向）。2026-10-13 起美术逐阶段引入：
到了的资源我就接进游戏，没到的地方先用代码画的占位。可以分批推，准备好多少推多少。

**阶段 1 的优先顺序**：鸟、野猫（橘色）、鼠、兔 → 巢 → 地形贴图（草地、灌丛、海岸、浅水、深水）→ 黑白猫。
苔原、农田贴图和工作室插画是后面阶段的，不急。

## 统一规格

- 格式：PNG，**背景透明**（地形贴图除外）
- 视角：正俯视，略带一点斜上方，看得出头和尾（俯视还是 2.5 维要在阶段 1 后定；先按俯视做）
- 动物：每只单独出图 512×512；粗墨线轮廓、线宽一致；平涂，**不要渐变、不要投影**
- 每个物种一张横排小表：站立 / 行走两帧 / 卧倒（具体见下）
- 物种主色固定（图表里也用它）：

| 用途 | 颜色 |
| --- | --- |
| 纸 | `#F3EDE0` |
| 墨 | `#1F1D1A` |
| 蓝图蓝（玩家的批注） | `#2F5D8A` |
| 朱红（警报、印章） | `#D2462E` |
| 鸟 | 白身 `#F7F5F0`、黑帽；图表里用炭黑 `#3A3A3A` |
| 兔 | 沙色 `#C9A97A` |
| 鼠 | 蓝灰 `#7D8A99` |
| 野猫 | 橘 `#D98A3D`，另有黑白一种 |

## 提示词

**风格锚**（每条都加在最前面）：

> Naturalist's field notebook illustration, bold uniform black ink outline, flat color fill with no gradients and no shading, slightly imperfect hand-drawn line, top-down view tilted slightly so head and tail are readable, isolated on transparent background, consistent line weight, game sprite sheet

**反向词**（每条都加）：

> pixel art, 3D render, realistic photo, cel-shaded anime, engraving, vintage flat poster, tabletop miniature, gradients, drop shadows

**动物（阶段 1 用）**

| 文件名 | 提示词（接在风格锚后面） |
| --- | --- |
| `species-bird-sheet.png` | a small ground-nesting island bird, white body #F7F5F0 with a solid black cap, short legs, sprite sheet: standing, two walking frames, sitting on nest, 4 frames in a row |
| `species-cat-orange-sheet.png` | a feral domestic cat, orange tabby #D98A3D, sprite sheet: standing, two walking frames, crouching to pounce, lying down |
| `species-cat-bw-sheet.png` | the same feral cat in black-and-white coat, same four poses |
| `species-rat-sheet.png` | a ship rat, blue-grey #7D8A99, long tail, sprite sheet: standing, two running frames, lying down |
| `species-rabbit-sheet.png` | a European rabbit, sandy #C9A97A, sprite sheet: sitting, two hopping frames, lying down |
| `nest-sheet.png` | a simple ground nest with three speckled eggs, and the same nest empty, 2 frames |

阶段 0 的田鼠、伶鼬、白鼬可以顺便做（同一模板换物种描述），不强求。

**水彩地形**（无缝贴图，1024×1024，不透明）：

> Soft low-contrast watercolor texture, slightly desaturated, visible paper grain, seamless tileable, no ink lines, no objects, top-down: **{X}**

`{X}` 依次换成下面这些，文件名对应 `terrain-<名字>.png`：
grassland meadow（`grassland`）、dense shrubland（`shrubland`）、sandy coast（`coast`）、shallow sea water（`shallow-water`）、
deep sea water（`deep-water`）、tundra（`tundra`）、farmland strips（`farmland`）

**工作室插画**（阶段 4 用，横版，例如 1920×1080）：

> Cozy small design studio of a species patent office, watercolor washes with bold ink outlines, naturalist field-notebook style, cream paper background, drafting tables with blueprint-blue drawings, filing cabinets, specimen cabinet with small animal models, an old telephone, a window showing a small test garden, a cat sleeping on paperwork, warm and quiet, no text

文件名 `studio.png`。

## 产出

- 全部放进 `art/incoming/`，按上面的文件名
- 同一张图有多个候选的，加后缀 `-a`、`-b`，我挑选后再整理
- 在 `art/incoming/NOTES.md` 里记一笔：用的是哪个图像模型 / 工具、生成日期、有没有手工修改
  （以后要统一风格、或者重新生成时需要）

```sh
git checkout main && git pull
git checkout -b human/002-art-assets
# 把图片放进 art/incoming/
git add art/incoming/
git commit -m "美术：第一批动物精灵 / 地形贴图"
git push -u origin human/002-art-assets
```

## 验收（我来做）

尺寸、透明背景、线宽一致、主色对得上；同屏缩到 32–64 像素时还认不认得出物种。
不合格的我会写清楚哪里要改，必要时调整提示词。
