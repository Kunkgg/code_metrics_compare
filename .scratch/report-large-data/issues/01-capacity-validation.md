# 大数据容量验证记录（每侧 10 万文件 / 100 万函数）

Status: resolved

分支 `prototype/prd-ui-comparison-large-data`。本记录为 P1 容量证据，不替代 P2/P3 全矩阵验收。

## 环境与口径

- 设备：MacBook Air（Apple M5，10 核，16 GB），macOS；参考设备要求（4 核/16GB/SSD）满足 CPU/内存项，未测 4 核低端机。
- 浏览器：Chrome 156.0.8078.48 headless，独立临时 profile（`--user-data-dir`），`file://` 直开，`agent-browser` CDP 断网（offline on）。**Edge 未安装，未测试**；headed 模式未测。
- 测量口径：查询耗时 = 页内 `performance.now()` 覆盖「发消息 → Worker 计算 → DOM 更新 → 两次 requestAnimationFrame」，热查询每任务 20 次，P95 取 nearest-rank；Worker 纯计算时间单独记录。内存 = 专用 Chrome 进程树 RSS 之和，0.5s 采样；该口径重复计算共享页，是偏保守的上界，未做干净会话差分。
- 数据：`prototype_scale_data` 固定种子 20261021；每侧精确 100,000 文件、1,000,000 函数；非空非注释代码行约 1.8 亿/侧（超过 2,500 万目标线，偏保守）；churn 2%/侧（并集 102,000 文件）；两个重复片段组各 10,000 成员；整文件重复 1,000；歧义率 20%（同名歧义函数行 20,568）。紧凑规则合成，不声称逐行 L3；1k/10k 同路径数据通过现有 L1+L2。

## 产物与生成端

| 数据集 | HTML 体积 | 构建耗时 | 构建峰值 RSS | 生成耗时（两侧 JSON） |
|---|---|---|---|---|
| 1k（冒烟，L1L2 通过） | 270 KB | 0.22 s | 52 MiB | 2.2 s |
| 10k（L1L2 通过） | 1.66 MB | 2.1 s | 325 MiB | 108 s（校验占主导） |
| 100k 满变化 mixed | 14.46 MB | 20.8 s | 2.83 GiB | 9.4 s / 505 MiB |
| 100k 低变化 0.01 | 14.45 MB | 20.8 s | 2.24 GiB | 9.4 s |
| 100k wide | 14.35 MB | 19.6 s | 2.21 GiB | 8.3 s |

门槛对照：HTML ≤200 MiB ✓；构建 ≤10 min ✓；构建内存 ≤8 GiB ✓。gzip+base64 后函数二进制表每侧约 6.1 MB。

## 浏览器端（100k 满变化 mixed 为主）

冷启动：DOMContentLoaded ≈ 57 ms；分块解码合计 ≈ 360–400 ms（函数表两侧各 ≈150 ms）；索引构建 8 ms；**打开至概览可操作 < 1 s**（门槛 ≤10 s ✓）。low/wide 数据集同为 ~360 ms。

热查询 P95（端到端 / Worker 纯计算，ms）：

| 任务 | 范围规模 | P95 端到端 | P95 Worker |
|---|---|---:|---:|
| 文件·全部变化·全局排序 | 102,000 候选 | 267 | 33 |
| 函数·全部变化·全局排序 | 979,662 行 | ~300 | 154 |
| 函数·同名歧义 | 20,568 行 | 226 | 110 |
| 函数·无变化（低变化集，path 排序） | 950,074 行 | 392 | 221 |
| 目录下钻 src/bulk 文件 | 33,999 | 219 | 15 |
| src/bulk 函数变化排序 | 326,430 | 261 | 70 |
| 路径搜索 added_000 / unit_099 | 1,000–9,794 | 237–262 | 33 |
| wide 12,500 子目录分页 | 12,500 | 300 | 4 |
| wide 目录路径搜索 bucket_012345 | 全部目录 | 300 | 2 |
| 超大目录 / 危险调用 / 重复清单 | — | ≤288 | ≤25 |
| 证据（含万成员组分页） | — | ≤229 | ≤3 |

全部低于「常用操作 P95 ≤1 s」门槛；最重 Worker 计算为 95 万行按路径排序取首页（221 ms）。

内存：专用 Chrome 进程树 RSS 峰值 **1,433 MB**（首载+首轮查询期），预热后稳定 ~1,123 MB（门槛 ≤2 GiB ✓，口径见上）。

正确性：三套 100k 数据 `verify` 均 **26/26 通过**——紧凑数组重算的 33 项汇总、目录数、超大目录数、并集/新增/移出/修改存续文件数全部与生成端 manifest 台账一致。界面冒烟（1k/100k）覆盖目录下钻、状态筛选、搜索、行选择、函数两侧记录、重复组与万成员分页、危险/冗余位置、复制定位。截图：`assets/100k-overview.png`、`assets/100k-workspace-bulk.png`。

## 结论与沉淀

1. **路线可行**：紧凑二进制分块 + gzip/base64 内嵌 + Blob Worker 在目标规模（每侧 10 万文件/100 万函数）下满足体积、加载、查询、内存四项门槛，余量大（HTML 14.5/200 MiB，查询 P95 ≤0.4/1 s，RSS 1.4/2 GiB）。
2. **交互方式结论**：大数量级下「目录只显示单层子项 + 分页 + 全范围路径搜索直达」可保留完整可达性——wide 12,500 子目录无需展开即可搜索定位（P95 300 ms）；明细全范围筛选排序后分页，每行证据（含万成员重复组）可分页到达。
3. **正式实现需带走的做法**：排序/筛选在 Worker 引擎层完成（DOM 只接收当前页 50 行）；目录计数与直接子项在生成端预计算；数值列用 TypedArray 二进制分块；top-K 截断使全局排序只需 O(范围)+O(K log K)；输入框 DOM 稳定 + 版本号丢弃过期响应。

## 未验证与限制（不宣称通过）

- Edge/跨 OS/headed/真实双击交互未测；4 核低端参考机未测；未做长时使用与缓存增长观察。
- 压力夹具为紧凑规则合成，非逐有效行 L3；100k 数据未跑 L1/L2（同代码路径 1k/10k 已通过）。
- 20 项分析指标中，超大文件/超大函数/超大复杂度三类入口未接线（本轮验证导航与核心查询，非完整业务原型）；均值/比例贡献分解未纳入。
- 内存为进程树 RSS 上界口径，未做干净会话差分与 JS heap 分离；P95 基于 20 次热样本，冷查询未单独成表（首轮样本在日志中，量级相同）。
- 变化比例矩阵仅覆盖 1% 与 100%（低/满）；30% 中档与「接近 100% 大量增删」未单独成集。

## 当前复现入口

目录整理后，以下命令在仓库根目录执行；只更新入口，不代表重新测量或改变上述结论。源码位于 `prototypes/performance/`，留存的 scale-check manifest 位于 `.scratch/report-large-data/assets/scale-check-100k-manifest.json` 和 `.scratch/report-large-data/assets/scale-check-small-manifest.json`。

```bash
uv run python -m scripts.prototype_scale_data --num-files 100000 --output-dir output/scale-100k-full
uv run python -m prototypes.performance.prototype_capacity --input-dir output/scale-100k-full
open output/scale-100k-full/capacity-report.html
```

## 复现命令（归档分支当时记录）

```bash
uv run python -m cmetrics_cmp_viz.prototype_scale_data --num-files 100000 --output-dir output/scale-100k-full
uv run python -m cmetrics_cmp_viz.prototype_capacity --input-dir output/scale-100k-full
open output/scale-100k-full/capacity-report.html   # 断网双击等价
# 页内测量：window.scalePrototype.bench('query', {type:'methods', status:'changes'}, 20)
# 页内校验：window.scalePrototype.run('verify') → {failed: 0, total: 26}
```
