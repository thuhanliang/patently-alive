# Patently Alive（生生事务所）

物种设计 + 生态推演 + 兽医干预的游戏。设计文档见 `docs/`，协作约定见 `CLAUDE.md`。

当前阶段：**阶段 0 · 灰盒推演**（见 `docs/PHASE0.md`）。

## 运行

需要 Node 22.12 以上。

```sh
npm install
npm run dev        # 本地试玩，地址栏加 ?seed=123 可以换种子
npm test           # 确定性、内核纯净性等测试
npm run typecheck  # 两遍类型检查：整个项目一遍，模拟内核单独一遍（不带 DOM 类型）
npm run build      # 类型检查 + 打包到 dist/
```

## 目录

- `src/sim`：模拟内核。纯 TS、固定步长、带种子随机数；不引用渲染、DOM 和系统时钟。
- `src/render`：画面（PixiJS），只读推演状态。
- `src/ui`：界面。
- `src/data`：数据文件与 schema。
- `tests`：测试。
