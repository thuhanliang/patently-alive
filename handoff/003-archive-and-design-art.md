# 003 · 档案馆与设计台的美术

状态：**待办**　　分支：`human/003-archive-design-art`　　急不急：阶段 2A / 3 要用，到一批接一批

阶段 1 之后的顺序是：阶段 2 的前置部分（2A：档案馆条目、投放）→ 阶段 3（设计台与专利）。见 `docs/PHASE2.md`、`docs/PHASE3.md`。
这份清单比较长，**不用一次做完**。下面按用到的先后排好了，做好一批就推一批。
没到的地方我照样用代码画的田野笔记占位，开发不会卡住。

规格、风格锚、反向词沿用 `002-art-assets.md`（纸色、墨线、平涂、不要渐变和投影）。下面只写新增的部分。
**002 里的四种动物和巢仍然最优先**，它们定下的画法（线宽、比例）也是本清单的参照。

## 优先顺序

1. A · 档案馆标本像（2A 用）
2. B · 设计台：蓝图部件和可染色的体型模板（阶段 3 第 3 步用，**实验性**）
3. C · 新物种的精灵（2A 投放、阶段 3 用）
4. D · 申请书、审查意见、证书、印章（阶段 3 第 5–6 步用）

## A · 档案馆标本像

档案馆每一条现有技术都有一张"标本像"，像田野笔记里的物种插图：**侧面全身**、四脚着地或站立、看得出体型比例。

- 规格：768×512，透明背景，粗墨线 + 平涂，**图里不要文字**（名字和数据由界面排）。
- 提示词：接在风格锚后面，把"top-down view…"换成 `side view, full body, standing, specimen plate, natural proportions`，再接下面每行的描述。
- 文件名：`archive-<id>.png`。

| id | 物种 | 描述（接在提示词后） | 主色 |
| --- | --- | --- | --- |
| `cat` | 野猫 | a feral domestic cat, orange tabby | 橘 `#D98A3D` |
| `dotterel` | 双斑鸻 | a banded dotterel, small plover, white underparts with two dark breast bands, brown back | 白身 `#F7F5F0` |
| `rabbit` | 穴兔 | a European rabbit, sandy | 沙色 `#C9A97A` |
| `rat` | 船鼠 | a ship rat (black rat), long thin tail, large ears | 蓝灰 `#7D8A99` |
| `vole` | 田鼠 | a field vole, short tail, blunt nose | 灰褐 `#8C8270` |
| `weasel` | 伶鼬 | a least weasel, slender long body, brown back white belly | 栗色 `#A8714A` |
| `stoat` | 白鼬 | a stoat, long body, black tail tip | 深栗 `#6E4A33` |
| `norway-rat` | 褐家鼠 | a brown rat, stocky, shorter tail than a ship rat | 褐灰 `#6F665C` |
| `kiore` | 太平洋鼠 | a Pacific rat (kiore), small slender rat | 浅褐 `#9C8A72` |
| `mouse` | 小家鼠 | a house mouse, tiny, large ears | 灰 `#9A968E` |
| `mongoose` | 红颊獴 | a small Indian mongoose, slender, grizzled olive-brown fur, pointed snout | 橄榄褐 `#8A7A4E` |
| `ferret` | 雪貂 | a feral ferret, cream body with dark legs and dark face mask | 奶油 `#E2D3B0`、深褐四肢 |
| `fox` | 赤狐 | a red fox, bushy tail with white tip | 赤 `#C4622D` |
| `possum` | 帚尾袋貂 | a common brushtail possum, grey, bushy black tail, large ears | 银灰 `#8E9196` |
| `kiwi` | 褐几维 | a North Island brown kiwi, round body, long thin beak, no visible wings | 棕 `#7A5B3A` |
| `weka` | 威卡秧鸡 | a weka, flightless brown rail, sturdy legs | 栗褐 `#8B5E34` |
| `kakapo` | 鸮鹦鹉 | a kakapo, large flightless moss-green parrot, owl-like face | 苔绿 `#7C9A4A` |

鸟岛四种和阶段 0 三种已经有精灵需求（002），标本像是另一张图（侧面全身），请分开出。

## B · 设计台：蓝图部件和体型模板（实验性）

阶段 3 的设计台上，玩家拼装一只动物，画面是**蓝图蓝的线稿**，随选择实时变化。
我打算先用代码按参数画线稿，这部分素材是**试验**：生成出来能对齐就用，对不齐也没关系，你不用为此反复返工。

### B1 · 蓝图部件

- 规格：512×512，透明背景，**只有线条**，颜色蓝图蓝 `#2F5D8A`，不填色。
- 都画**侧面**，同一个比例尺：躯干的中心放在画布中心，头朝右。
- 风格锚换成：

  > Technical blueprint line drawing of an animal body part, single color #2F5D8A thin even lines on transparent background, patent drawing style with light construction lines, side view, no shading, no fill, no text

- 文件名：`part-<类>-<名>.png`。

| 类 | 名字（文件名用英文） | 描述 |
| --- | --- | --- |
| torso | `small`、`medium`、`large`、`long` | 小型 / 中型 / 大型的哺乳动物躯干，long 是鼬一样细长的躯干 |
| torso | `bird` | 鸟的躯干（无翼） |
| head | `incisors` | 啮齿动物的头：一对门齿 |
| head | `carnivore` | 食肉动物的头：犬齿、短吻 |
| head | `grazer` | 食草动物的头：长吻、宽平的臼齿 |
| head | `beak-short`、`beak-probe` | 短粗的种子喙 / 细长的探针喙 |
| legs | `plantigrade`、`digitigrade`、`hooves` | 跖行 / 趾行 / 蹄 |
| legs | `climbing-claws` | 带弯爪的攀爬四肢 |
| legs | `hopping` | 长后腿、跳跃的兔型四肢 |
| legs | `bird-walking` | 鸟的走禽腿 |
| wings | `folded`、`spread` | 收起 / 展开的翼 |
| tail | `thin-long`、`bushy`、`short`、`balance` | 细长 / 蓬松 / 短 / 粗壮的平衡尾 |
| coat | `fur-short`、`fur-long`、`feathers`、`bare` | 体表的纹理层：短毛 / 长毛 / 羽 / 裸皮（只有纹理线，叠在躯干上） |

### B2 · 可染色的体型模板

设计好的物种投放到世界里以后，要用玩家选的主色显示。所以需要几种**白色填充**的通用体型，由代码染色。

- 规格：同 002 的精灵（512×512、俯视、墨线、四帧横排），但**填色一律纯白 `#FFFFFF`**，只保留墨线。
- 文件名：`template-<名>-sheet.png`：
  - `small-quadruped`：小型四足，鼠到猫大小；
  - `long-bodied`：细长四足，鼬型；
  - `hopper`：跳跃型，兔型；
  - `ground-bird`：地面活动的鸟；
  - `large-quadruped`：大型四足，狐狸以上。

## C · 新物种的精灵

A 里新加的 10 种（褐家鼠到鸮鹦鹉），按 002 的精灵规格各出一张：俯视、四帧横排。

- 文件名：`species-<id>-sheet.png`。
- 主色用上表那一列。

## D · 申请书、审查意见、证书、印章

阶段 3 后半用。**图里都不要文字**：中文字由界面排上去，图像模型写的字不可靠。

| 文件名 | 规格 | 描述 |
| --- | --- | --- |
| `paper-drafting.png` | 1024×1024，无缝 | 浅蓝细方格的绘图纸，纸色底，低对比 |
| `paper-application.png` | 1240×1754（A4 竖版） | 申请书的纸：纸色底，左侧装订孔，页边细线，顶部空出一条抬头位置 |
| `letterhead-examiner.png` | 1240×300 | 专利局公函抬头：庄重的细线纹饰，中间留空（放局名），墨色单色 |
| `certificate-frame.png` | 1754×1240（横版） | 专利证书的边框：细致的墨线花边，四角有植物与动物纹样，中间大面积留空 |
| `card-archive.png` | 768×480 | 档案馆的索引卡：纸色，顶部一条分类标签凸起，细横线 |
| `seal-round.png`、`seal-square.png`、`seal-oval.png` | 512×512 透明 | 朱红 `#D2462E` 的空白印章：只有边框和印泥的不均匀质感，**中间不要字** |
| `doodle-*.png` | 256×256 透明，若干张 | 档案馆员的页边小涂鸦：放大镜、回形针、咖啡杯印、小蜗牛、一只打盹的猫，墨线单色 |
| `desk-drafting.png` | 1920×1080 | 设计台俯视：木质绘图桌，边缘放尺子、圆规、铅笔、标本瓶，**中间大面积留空**（放线稿），水彩 + 墨线 |

## 产出

- 全部放进 `art/incoming/`，文件名同上；多个候选加后缀 `-a`、`-b`。
- 在 `art/incoming/NOTES.md` 里记一笔：用的模型或工具、日期、有没有手工修改。

```sh
git checkout main && git pull
git checkout -b human/003-archive-design-art
# 把图片放进 art/incoming/
git add art/incoming/
git commit -m "美术：档案馆标本像 / 设计台部件 / 文书素材"
git push -u origin human/003-archive-design-art
```

## 验收（我来做）

- A、C：主色对得上；标本像的比例像真实动物；缩到 96 像素宽还认得出。
- B：同一类部件比例一致、能大致对齐。对不齐就只当参考，线稿用代码画。
- D：没有文字；印章的朱红和配色表一致；纸色和 `#F3EDE0` 接近。
