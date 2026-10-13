# Patently Alive（生生事务所）

物种设计 + 生态推演 + 兽医干预的游戏。设计文档见 `docs/`，协作约定见 `CLAUDE.md`。

当前阶段：**阶段 1 · 野猫与鸟岛**（见 `docs/PHASE1.md`）。阶段 0（灰盒推演）已过关。

在线试玩：<https://thuhanliang.github.io/patently-alive/>（`main` 每次更新后自动发布）。

## 运行

需要 Node 22.12 以上。

```sh
npm install
npm run dev        # 本地试玩；地址栏加 ?seed=123 换种子，?speed=100 换倍速
npm test           # 确定性、内核纯净性等测试
npm run typecheck  # 两遍类型检查：整个项目一遍，模拟内核单独一遍（不带 DOM 类型）
npm run build      # 类型检查 + 打包到 dist/
npm run sweep      # 批量推演：多个种子跑 10 年，打印起伏和报警（SEEDS / YEARS / SIZE / SEED0 可调）
```

## 操作

- 拖拽平移，滚轮缩放；`1` 全图，`2` 地块（放大后中央区域展开成个体）。
- 空格暂停 / 继续，`.` 单步一天，`[` `]` 切换 1 / 10 / 100 倍速。
- 右上角切换数据图层（植被 / 各物种密度，一次一层）。
- 下方种群曲线：默认每个物种按自己的最高值缩放（看起伏），点一下切换成对数纵轴（比数量）。
- 投放：选物种和数量，打开"投放模式"，在地图上点一下。
- 所有会改变推演的操作都走统一操作接口（`src/sim/session.ts`）并写进操作日志；
  "导出日志"得到的 JSON 就是存档，"载入日志回放"可以原样重现。

## 草原里有什么

田鼠、穴兔两种食草动物，伶鼬、白鼬两种小型捕食者。参数来自 PanTHERIA、AnAge（见 `docs/DATA_CHECK.md`、`LICENSES-DATA.md`），
建模假设和调参记录见 `docs/MODEL.md`。值得看的：

- 季节：春夏繁殖、冬季减少，植被跟着季节涨落。
- 田鼠–伶鼬周期：伶鼬跟着田鼠涨，涨过头把田鼠吃下去，自己再跟着跌，约 6 年一轮（头一轮要等 4–5 年，用 100x）。
- 白鼬守领地、数量稳；田鼠少的年份它多吃兔子，兔子也跟着起伏。

## 需要在本地完成的任务

开发环境不能访问的外部数据、需要图像模型生成的美术资源，写在 `handoff/` 里，见 `handoff/README.md`。

## 目录

- `src/sim`：模拟内核。纯 TS、固定步长、带种子随机数；不引用渲染、DOM 和系统时钟。
- `src/render`：画面（PixiJS），只读推演状态。
- `src/ui`：界面。
- `src/data`：数据文件与 schema。
- `tests`：测试。
- `scripts/data`：外部性状数据库的下载与核对（`npm run data:fetch`、`npm run data:check`）。
- `docs/MODEL.md`：推演用到的每个数字从哪里来（数据 / 规律 / 假设）、可调范围。
- `handoff/`：需要在本地完成的任务。
