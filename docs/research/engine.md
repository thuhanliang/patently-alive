# 渲染引擎的选择（2026-11-22）

## 为什么要重新选

试玩反馈（2026-11-21）：地图打不开；纸剧场的素材是整块贴图，裁边粗糙，层次和纸的厚度是"画出来的"不是"生成出来的"，地面有一道很宽的缝。用户要求跳出现有做法，从整个游戏的角度设计技术架构；可以用代码生成整个场景，大胆尝试。

现在的做法（PixiJS 2D）的根本限制：

- **剪纸的厚度、层与层之间的投影只能画在贴图里**，光一变就不对，也动不了。
- **地形是逐像素画的**：小岛细分以后 2304×2304 像素，画一张要几十秒，这是"打不开"的根源。
- **侧面的纸偶放在俯视的地图上**，只能横着飘、被植物挡住。

## 候选

| 方案 | 适合我们的地方 | 问题 |
| --- | --- | --- |
| **three.js（WebGL2 渲染器）** | 体积最小（three 约 185 KB）；同一份基准测试（Apple M1 Pro，Chrome 和 Safari）里，WebGL2 下每个物体单独一份网格能撑 9.1k 个，比它自己的 WebGPU 渲染器（2.5k）多；生态最大；纯代码、不依赖编辑器；能直接接现有的 TypeScript 推演、纸偶骨骼 | 景深、环境光遮蔽要自己用后期库组装 |
| three.js（WebGPU 渲染器 + TSL） | 新一代着色语言，没有 WebGPU 时自动退回 WebGL2 | 上面那份基准测试里每个物体一份网格时明显更慢；iPad 上 WebGPU 从 iPadOS 26 才默认打开，早期版本有 bug，到 26.4 才修好 |
| Babylon.js | 景深、SSAO、泛光开箱即用，材质最完整 | 0.5–1.5 MB，加载已经是我们的痛点 |
| PlayCanvas | 体积小，性能好 | 以可视化编辑器为中心，不适合纯代码生成的工作方式 |
| Godot（网页导出） | 完整的游戏引擎 | 网页版只能用 WebGL2 兼容渲染（不支持 WebGPU），包体 20 MB 以上，iOS Safari 有上下文丢失、崩溃的报告 |

## 结论

**用 three.js 的 WebGL2 渲染器**，所有 iPad 都能稳定跑；以后要换 WebGPU 渲染器只改一处。
后期（景深、环境光遮蔽、抗锯齿）用 three 自带的 EffectComposer，必要时换成更快的后期库。

## 新的架构（逐步迁移）

1. **一张 3D 画布贯穿整个游戏**：工作台、岛、纸剧场、设计台是同一个场景里的不同地方，场景之间是镜头移动，不再整页跳转、内嵌页面。
2. **一切都是真的纸**：每张纸是有厚度的薄片（正面、侧面的白色断面），用程序生成的纸纹（法线、粗糙度），被同一盏台灯照亮、互相投影。形状由代码生成（远山、海浪、草叶、灌丛的叶子、云、台口），所以能动、能换季、能随推演变。
3. **岛也变成纸雕**：地形按等高线一层层切成纸片叠起来（就是 2026-10-22 定的"纸雕式多层地形"真的做出来），几何生成只要零点几秒，不再逐像素画。
4. **纸偶**：2D 的骨骼和步态照旧（它只算数），每片零件挤出成有厚度的 3D 纸片，用黄铜铆钉钉在一起（`src/render/three/puppet3d.ts`）。
5. **推演**照旧在 Worker 里；界面里大段文字的卡片仍用网页元素，能拿在手里的东西（信、章、手摇把）做成 3D 物件。
6. **Lovart 的角色变了**：出概念图定调、出材质参考（纸纹、木纹），不再出拿来直接贴的整块素材。

## 2026-11-22：纸雕岛（第二个竖切片，`island3d.html`）

- **整座岛切成纸**：推演只有每格的地形类别，高度由画面推出来（离海越远越高、灌丛略高、加起伏；海里离岸越远越深），按等高线切成十一层水、一层沙、五六层绿，每层是挤出来的纸板（`relief.ts`、`contour.ts`）。搭整座岛不到 1 秒（软件渲染），不再逐像素画。
- **接缝的暗**：每一点离"比它高一层的纸"多近，烤成一张铺满地面的灰度图，乘到纸上；再加真的斜阳阴影。
- **纸不光滑**：纸纹加了冷压水彩纸的"齿"、纸浆斑点，两种尺度叠起来；全部纸 roughness = 1；屏幕上再加一点颗粒、暗角；推近时移轴模糊，像拍桌上的模型。
- **立着的剪纸植物**：灌丛（前后三张）、草丛、海边的石头都是实例化的纸片，正对镜头、俯视时往后仰，随风摆（`plants.ts`）。
- **更大的范围**：岛外是十几座只作布景的小岛，远海一直铺到地平线、融进雾里。
- **镜头手感**（`mapCamera.ts`）：抓住地面拖、松手有惯性；朝指着的地方推近；越近越低；右键或双指转（±45°）、调俯仰（0–60°）。

## 来源

- three.js、Babylon.js、PlayCanvas 的 WebGL2 / WebGPU 基准测试：<https://github.com/endel/webgpu-webgl-benchmarks>
- 三个引擎的体积和定位：<https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison>
- WebGPU 在各浏览器的支持：<https://github.com/gpuweb/gpuweb/wiki/Implementation-Status>，<https://web.dev/blog/webgpu-supported-major-browsers>
- iPad 上 WebGPU 早期的 bug（到 Safari 26.4 修好）：<https://bugs.webkit.org/show_bug.cgi?id=299237>
- three.js WebGPU 渲染器：<https://threejs.org/manual/en/webgpurenderer.html>
- Godot 网页导出的限制：<https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html>，包体测试 <https://github.com/JohannesDeml/Godot-Web-LoadingTest>
