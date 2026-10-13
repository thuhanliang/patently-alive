# 001 · 下载 PanTHERIA、AnAge，核对物种数据

状态：**待办**　　分支：`human/001-trait-data`

## 为什么要做

物种数据（体重、每窝只数、妊娠期、性成熟……）目前是凭已有知识填的估计，没有对照数据库核对过
（数据文件的 `source` 里都标了【未核对】）。先核对，再调参，免得调好的平衡在换成真实数据后要重来。
云端开发环境访问不了这两个数据库的网站，所以请在本地下载。

## 需要的东西

- Node 22.12 以上（和平时跑项目一样）
- `curl` 和 `unzip`：macOS、Linux 自带；Windows 请在 Git Bash 或 WSL 里运行下面的命令
  （没有 `unzip` 也行，见下面"手动下载"）

## 步骤

```sh
git checkout main && git pull
git checkout -b human/001-trait-data
npm install

# 1. 下载两个数据库，并把文件的校验和记进 scripts/data/sources.json
npm run data:fetch -- --pin

# 2. 抽取本游戏物种（和后续阶段要用的物种）的记录，生成核对表
npm run data:check

# 3. 提交并推送
git add scripts/data/sources.json data-external/ docs/data/traits-reference.json docs/DATA_CHECK.md
git commit -m "数据：下载 PanTHERIA、AnAge 并生成物种核对表"
git push -u origin human/001-trait-data
```

### 如果第 1 步下载失败

用浏览器手动下载，保存到指定位置（文件名必须一字不差），然后重新运行第 1 步（已存在的文件不会重新下载，只会记校验和）：

| 数据库 | 下载地址 | 保存为 |
| --- | --- | --- |
| PanTHERIA | https://esapubs.org/archive/ecol/E090/184/PanTHERIA_1-0_WR05_Aug2008.txt | `data-external/PanTHERIA_1-0_WR05_Aug2008.txt` |
| AnAge | https://genomics.senescence.info/species/dataset.zip | `data-raw/anage_dataset.zip` |

如果 AnAge 的地址变了，在 https://genomics.senescence.info/species/ 页面找 "Download" 的完整数据集（zip，里面是 `anage_data.txt`）。
下载到的文件名不同就改成上表的名字。

如果 `unzip` 不可用：把 zip 手动解压到 `data-raw/anage/`（确保里面有 `anage_data.txt`），再运行第 2 步；脚本会优先读解压好的文件。
如果第 1 步提示"可能是报错网页"或"下载不完整"：删掉那个文件，用浏览器重新下载。

## 产出（只提交这些）

- `scripts/data/sources.json`：填好了两个 `sha256`
- `data-external/PanTHERIA_1-0_WR05_Aug2008.txt`：PanTHERIA 整份（CC0，可以放进仓库，约 2.6 MB）
- `docs/data/traits-reference.json`：四个物种 + 后续阶段物种的数据库摘录
- `docs/DATA_CHECK.md`：核对表

**不要提交** `data-raw/`（已在 `.gitignore` 里；AnAge 的再分发条款没确认，只提交摘录）。

## 验收（我来做）

1. 校验和能对上；`npm run data:check` 在我这边重跑，结果一致。
2. 逐条看 `docs/DATA_CHECK.md` 里标"⚠ 偏离"的项：改成数据库值，或在物种文件的 `source` 里写明为什么不同
   （例如白鼬有延迟着床，数据库的妊娠期可能包含停育期，模型只算着床之后）。
3. 把物种文件 `source` 里的【未核对】换成具体出处，更新 `docs/MODEL.md`。
4. 然后继续阶段 0 第 6 步（调参、平衡回归、GitHub Pages）。
