# data-external：随仓库分发的原始数据

这个目录里的文件**会进仓库**，本地和云端开发都可以直接读，不必再联网下载（运行时不联网，铁律 6）。
放进来的前提是许可允许再分发——下面两个库的许可都在 **2026-10-13** 从各自官网核实过，都允许再分发，条件是**署名**。

## PanTHERIA 1.0

| | |
| --- | --- |
| 文件 | `PanTHERIA_1-0_WR05_Aug2008.txt`（2,359,096 字节；1 行表头 + 5416 条记录） |
| sha256 | `36e64314cae0394a966a63b949504d1975ac5c5629e05e36c1b139b3348f044a` |
| 来源 | https://esapubs.org/archive/ecol/E090/184/PanTHERIA_1-0_WR05_Aug2008.txt |
| 存档页 | https://esapubs.org/archive/ecol/E090/184/ |
| 引用 | Jones, K.E. et al. (2009) PanTHERIA: a species-level database of life history, ecology, and geography of extant and recently extinct mammals. *Ecology* 90:2648. Ecological Archives E090-184. |
| 许可 | **CC BY 4.0** — ESA 版权页：*"Except where otherwise noted, Ecological Archives are covered under the Creative Commons Attribution (CC BY 4.0) license."*（https://esapubs.org/archive/copyright.htm） |
| 改动 | 无，原样保存 |

注：此前 `scripts/data/sources.json` 把 PanTHERIA 记作 CC0，与 ESA 版权页不符，已更正为 CC BY 4.0。

## AnAge（Build 15）

| | |
| --- | --- |
| 文件 | `anage_dataset.zip`（169,150 字节，官方下载原件） |
| sha256 | `e3ddb66e32e973a79932859ba53013e8f60d957c6ec01c6eb573e3ea3018d630` |
| 解压 | `anage/anage_data.txt`（786,146 字节；4645 条记录）<br>`anage/release.html`（官方 build 说明，含版本与引用格式） |
| `anage_data.txt` sha256 | `98867969fbd4d0bed6bab415c2715bb19079dbd7f92bdc26e5961856aa1c1519` |
| 来源 | https://genomics.senescence.info/species/dataset.zip |
| 引用 | Tacutu, R. et al. (2018) Human Ageing Genomic Resources: new and updated databases. *Nucleic Acids Research* 46:D1083–D1090.<br>另见 de Magalhães, J. P. et al. (2024) *Nucleic Acids Research* 52(D1):D900–D908. |
| 许可 | **CC BY 3.0** — HAGR 版权页：*"HAGR may be freely used for all purposes, including commercial, educational, and research purposes, provided you mention the use of HAGR"*，页面标注 Creative Commons Attribution 3.0 Unported（https://genomics.senescence.info/legal.html） |
| 改动 | 无，原样保存 |

## 这两份数据是什么

- `PanTHERIA`：哺乳动物生活史、生态、地理性状的物种级数据库，只覆盖哺乳动物（**没有鸟类**）。
- `AnAge`：动物的衰老与生活史数据库，含长寿记录，覆盖脊椎动物各纲，**含鸟类**。

游戏运行时不读这些文件；它们是开发期核对/调参的参考数据，摘录见 `docs/data/traits-reference.json`，核对结果见 `docs/DATA_CHECK.md`。

## 完整性核对（2026-10-13）

| 检查 | 结果 |
| --- | --- |
| PanTHERIA 记录数 vs 官方存档页 | 官方写明 "5416 records, not including the header row"；本文件 5417 行 = 1 表头 + 5416 ✅ |
| PanTHERIA 重新下载比对 | sha256 一致 ✅ |
| AnAge zip 自检 | `unzip -t`：`No errors detected` ✅ |
| AnAge 记录数 vs 官方 Build 15 的 "4,671 entries" | 4645 行 + **恰好 26 个 HAGRID 空缺** = 4671 ✅（release notes 说明 build 发布后条目有变动，HAGRID 被重排） |
| AnAge 是否被截断 | 最大 HAGRID = 4671（即上限），无重复，文件以换行结尾 ✅ |
| AnAge 重复下载比对 | sha256 一致 ✅ |
| 解压出的 `anage_data.txt` 与 zip 内条目 | 字节一致 ✅ |

## 维护

`npm run data:fetch` 会按 `scripts/data/sources.json` 里记录的 sha256 核对这两个文件；内容变了会报警。
`npm run data:check` 直接读这里的 AnAge 解压结果，不需要 `unzip`。
