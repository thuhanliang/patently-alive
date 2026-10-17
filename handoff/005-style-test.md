# 005 · 美术风格对比（M0 · V1）

状态：**待办**　　分支：`human/005-style-test`　　急不急：**现在最急**。风格定下来以前，002–004 的正式美术先暂停

2026-10-17 校准愿景时决定重新评估美术风格（见 `docs/GDD.md` 的"美术方向"和 `docs/ROADMAP.md` 的 M0）。
做法：**同样的四个画面 × 几种风格**，用你手边的图像生成工具跑图，放在一起横向比较。最后**只选一种风格**，不混搭。

## 每个画面都要守住的东西（用来公平比较）

- **物种和主色固定**：
  - 本地鸟：小型涉禽，白身黑头顶（双斑鸻一类）；
  - 野猫：橘色虎斑，另有一只黑白；
  - 船鼠：蓝灰；
  - 穴兔：沙色。
- **鸟岛**：温带海岛，草地、灌丛、海岸、几处小岩石，没有人类建筑。
- **玩家的干预**要看得出来：方形的陷阱、三角形的诱饵、圆形的采样点、线形的围栏，用一种醒目的"批注色"（田野笔记方案里是蓝图蓝）。
- **警报**只有一处，用朱红。
- **画幅**：游戏画面一律 16:9 横版，像截图，不要海报构图（海报式概念图已否决，见 DECISIONS）。

## 四个画面

**S1 事务所内景**：一间温馨的小型物种设计工作室。有绘图桌、档案柜、标本柜、电话和信箱，墙上挂着专利证书，桌上趴着一只猫。午后的光。画面右侧留出放界面面板的空白。
*EN:* cozy small species-design studio interior, drafting table, filing cabinets, specimen cabinet, old phone and mail slot, framed patent certificates on the wall, a cat napping on the desk, warm afternoon light, empty space on the right for UI panels, 16:9 game screenshot

**S2 鸟岛现场（全屏地图）**：全屏的岛屿局部，能看清几十只动物：鸟在灌丛边筑巢，两只野猫在草地上潜行，几只兔子，一只鼠。画面里有一个方形陷阱、一个三角诱饵、一条围栏线，和一处朱红警报（一个被毁的鸟巢）。屏幕边缘有极简的界面：时间、倍速、工具栏。
*EN:* full-screen game view of a temperate island meadow and scrub, dozens of small animals readable at a glance: white shorebirds with black caps nesting by shrubs, two orange tabby feral cats stalking, sandy rabbits, a blue-grey rat; a square trap, a triangle bait marker, a fence line in a bright annotation color, one vermilion alert on a destroyed nest; minimal UI on the screen edges (clock, speed, toolbar), 16:9 game screenshot

**S3 设计台**：正在设计一只新动物（像猫的中型食肉兽），侧面图居中。旁边有体重分配条（骨骼、肌肉、消化道、心血管、脂肪），一张能量收支小图，和一条"老同事的批注"便签。
*EN:* species design workbench screen, a new cat-like mid-size carnivore shown in side view at center, a body-mass allocation bar (bone, muscle, gut, heart, fat), a small energy budget chart, a handwritten sticky note of advice, 16:9 game UI screenshot

**S4 纪录片的一帧**：鸟岛的黄昏，低机位，一只野猫在前景草丛里，远处一群鸟起飞。电影感：景深、轻微移轴、调色，画面下方有一行字幕。
*EN:* cinematic frame from an auto-generated nature documentary, island at dusk, low camera angle, feral cat in foreground grass, flock of shorebirds taking off in the distance, shallow depth of field, slight tilt-shift, color graded, one line of subtitle at the bottom, 16:9

## 几种风格（每种风格在上面的提示词后面接一句）

| 编号 | 风格 | 接在提示词后面 |
| --- | --- | --- |
| A | 田野笔记 2D（现在的占位方案） | 博物学家田野笔记本的一页：柔和低对比的水彩自然，动物用粗墨线描边加平涂，干预用蓝图蓝墨迹，纸纹。*EN:* naturalist field notebook page, soft low-contrast watercolor terrain, animals with bold ink outlines and flat fills, blueprint-blue ink annotations, paper texture, top-down |
| B | 2.5D 等距 | 等距视角（2.5D），真实比例的地形和动物，柔和光照，干净的色块。*EN:* isometric 2.5D game view, natural scale terrain and animals, soft lighting, clean readable shapes |
| B′（可选） | 2.5D 微缩景观 | 在 B 的基础上做成桌上小模型的样子（移轴、玩具感）。**注意**："桌面微缩"以前被否决过，这一组是重新测试那个方向，结论单独看，不和 B 混在一起。*EN:* isometric miniature diorama, tilt-shift toy-like look |
| C | 低多边形黏土 / 白模渲染（和纪录片思路一致） | 白模加简单材质的建筑表现风格：低多边形、哑光黏土质感、环境光遮蔽、柔和天光，物种只用一个主色。*EN:* architectural-visualization style clay render, low-poly matte clay materials, ambient occlusion, soft sky light, each species a single solid color |
| D | 水彩绘本 | 儿童科普绘本，水彩加彩铅，温暖。*EN:* picture-book illustration, watercolor and colored pencil, warm and friendly |
| E | 你自定 | 你想试的任何一种（比如 2.5D 加田野笔记的配色） |

S2 最好每种风格都分别出**俯视**和**等距**两个视角（A 默认俯视，B、C 默认等距，D、E 随意），因为视角本身也要选（GDD 开放问题）。

## 评判（每组图打 1–5 分，写一两句话）

**AI 图判断不了"同屏几十上百只动物看不看得清"**：生成模型很难准确画出几十只小动物和精确的标记。这一项留到 V2，用真实精灵和真实推演测。AI 图只看下面 2–6 项，第 1 项只做参考。

1. **看得清（仅参考）**：S2 里动物、干预标记、警报大致分得开吗？
2. **认得出**：不看说明，能认出猫、鸟、兔、鼠吗？
3. **亲和**：对生物感兴趣、但不懂生态学的普通玩家，第一眼想不想玩？
4. **能动起来**：适合做几十只动物同屏的动画吗？适合做 15–30 秒的纪录片短片吗？
5. **做得出来**：能用代码画或少量素材实现，不用每只动物都手绘很多帧？
6. **独特**：放在 Steam 的同类游戏里，认得出是这个游戏吗？

## 产出

- 文件放在 `art/incoming/style-test/<风格编号>/<画面编号>.png`，例如 `art/incoming/style-test/B/S2-iso.png`；同一画面跑了好几张的，挑一张最好的，其余放 `extra/`。
- 一份 `art/incoming/style-test/NOTES.md`：每种风格的打分和评语，用了哪个工具、哪个模型。
- 推到 `human/005-style-test`，告诉我"完成了 005"。我会把结论整理进 GDD 的美术一节，并用选中的风格做 M0 的场景原型（V2）和纪录片样片（V3）。

## 验收

- 至少 A、B、C 三种风格各有 S1–S4。
- NOTES.md 有每种风格的打分。
