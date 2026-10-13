# 数据许可与署名

游戏用到的真实动物数据来自下面两个数据库，原始文件随仓库分发，放在 `data-external/`（核实过程见 `data-external/README.md`）。
游戏运行时不读这些文件；物种数据文件（`src/data/species/*.json`）里的数值参照它们填写，出处写在各自的 `source` 字段里。

| 数据库 | 版本 | 许可 | 引用 |
| --- | --- | --- | --- |
| PanTHERIA | 1.0（MSW05 分类，2008 年 8 月） | CC BY 4.0 | Jones, K.E. et al. (2009) PanTHERIA: a species-level database of life history, ecology, and geography of extant and recently extinct mammals. *Ecology* 90:2648. Ecological Archives E090-184. |
| AnAge（Human Ageing Genomic Resources） | Build 15 | CC BY 3.0 | Tacutu, R. et al. (2018) Human Ageing Genomic Resources: new and updated databases. *Nucleic Acids Research* 46:D1083–D1090. |

两份数据均未改动，原样保存。
