# 02 文件与目录完整任务

Type: task
Status: resolved

## 结果

阶段 1 完成。沿用 `prototypes/ui/` 的 HTML、CSS 和概览／分析／全部指标三页，增加紧凑报告入口；文件代码行的概览→目录→查询→原始证据→关联下钻／返回已在真实离线浏览器验证。全功能小样本旧路径保留为后续迁移的回归对照。

当前紧凑路径仍未接入函数等其他明细、12 项净影响、完整关联证据和异常样例。入口保留并明确提示；未完成类型不返回伪造的空集合数量。阶段 2–4 完成前，不能宣称全功能统一完成。

## 修改

- 容量 Worker 修正完整排序、深页／末页、稳定比较、空结果页、函数及危险函数名称查询、默认歧义、重复片段分页键；容量页面按查询／目录／证据校验响应代次，过期响应不提交，busy 按实际在途请求维护。
- 容量查询缓存只保留最后一组完整结果。函数排序切换触发重新计算，单独测量，不以缓存命中代替计算性能。
- 紧凑构建提取 `build_payload()`，两入口共享压缩块、路径／名称字典、TypedArray 及 Worker 索引；补齐两侧最大值、阈值转换和歧义计数。阈值转换在 1k 上与原始 JSON 的既有 UI 函数一致。
- `prototype.py --input-dir` 生成同一 UI 的紧凑报告；`--compact` 让原故事夹具也走同一路径。`query_reader.js` 与 `ui_worker.js` 返回当前页、完整数量、完整范围合计及有界概览；不把完整大对象搬到主线程。
- 文件查询按完整范围过滤／排序，缓存文件 ID；翻页后才恢复显示行。目录每页 50，概览图每页 20，文件排行榜每方向 8 且保留完整数量。页码输入、首页、末页可直接访问深页。
- 读取快照使用代次，连续输入保留焦点和选区。文件／关联／成员下钻使用 exactFile；清空／重置解除精确限制；查询和选择不丢返回栈，返回恢复范围、查询、排序、页和对象。
- 移除生成器和构建器的顶层 Unix resource 依赖。Windows 分支使用 OS 峰值工作集，其他平台保留原 RSS 单位换算；实际 Windows 仍未测试。

## 正确性证据

- 原有小 UI：1440px、390px 各 557 项断言通过；概览边界 24 项通过。pytest 28 项，Ruff、Pyright、JS 语法、diff 检查通过。
- 容量独立查询契约：29 项通过，包括完整函数多页摘要、不同排序首／深／末页；原 6 项失败均修正。冻结的阶段 0 产物仍保留。
- 紧凑 UI Worker 对原始输入的独立契约：故事夹具 **44 项**、1k **336 项**通过。覆盖全页排序内容摘要、数值条件与状态组合、完整范围合计、精确／相似路径、解除精确限制、空结果、各目录子目录与递归计数、概览完整数和前 8 项。
- 真实 Chrome、file://、CDP offline：故事夹具每尺寸 30 项，1k／10k／100k 每尺寸 31 项浏览器断言，均通过。覆盖搜索、数值条件、完整数、51／末页、关联精确定位、返回、过期查询、输入焦点、空页、34 项汇总、DOM 数量和横向溢出；初始化失败均保留 20 项静态指标。
- 正常页面无未处理脚本错误、无 HTTP(S) 请求。抽看桌面与窄屏截图，保留原三栏／响应式布局。

## 测量

沿用阶段 0 设备和显式 Chrome 156.0.8078.48。每规模 3 个独立 profile；首轮每任务 20 次，预热另存，nearest-rank P95；计时包含 Worker、DOM 和后续两帧。

| 规模／每侧 | HTML | 构建／打包时间 | 构建峰值 RSS | ready＋两帧（三次，ms） | 浏览器最大采样增量 |
|---|---:|---:|---:|---|---:|
| 故事：181 文件／545 函数 | 187.51 KiB | 约 0.01 s* | 36.8 MiB | 94.0 / 92.6 / 77.5 | 208.1 MiB |
| 1k 文件／10k 函数 | 321.01 KiB | 0.221 s | 50.6 MiB | 116.4 / 93.6 / 106.0 | 263.6 MiB |
| 10k 文件／100k 函数 | 1.64 MiB | 2.171 s | 325.8 MiB | 113.2 / 105.6 / 107.0 | 267.8 MiB |
| 100k 文件／1m 函数 | 13.85 MiB | 21.909 s | 2,687.5 MiB | 466.7 / 471.7 / 472.3 | 557.1 MiB |

* 此表为紧凑构建部分，不含故事夹具生成／L0–L3，也不含压力输入完整校验，不能关闭生成硬门槛。

| 完整交互 P95 | 故事 | 1k | 10k | 100k |
|---|---:|---:|---:|---:|
| 当前文件值升／降序交替，重新计算 | 165.4 ms | 125.1 ms | 178.6 ms | 201.1 ms |
| 全局路径条件交替，重新计算 | 170.7 ms | 250.1 ms | 186.7 ms | 195.5 ms |
| 第 51 页／末页交替（故事仅末页） | 178.6 ms | 250.3 ms | 157.3 ms | 199.7 ms |

以上只验阶段 1 文件／目录范围，不能继承为后续函数、净影响或关联证据的性能通过。浏览器 RSS 采样限制、未清 OS 磁盘缓存、Windows／Edge 缺失继续沿用阶段 0 记录。

独立容量查询修复实验另存：100k 的每次函数排序重算 P95 **400 ms**，完整浏览器实验最大采样增量 **1,131.7 MiB**。此实验与原阶段 0 的任务数不同，不能将峰值差额全归因于缓存；与统一 UI 文件任务也不混用。

## 复现

```bash
# 全功能旧 UI 与故事夹具的紧凑入口
uv run python -m prototypes.ui.prototype --output-dir output/unified-prototype/stage1/ui-legacy
uv run python -m prototypes.ui.prototype --compact --output-dir output/unified-prototype/stage1/ui-compact

# 同一 UI 接压力输入；可把 input-dir 换成1k、10k
uv run python -m prototypes.ui.prototype --input-dir output/scale-100k-full --output-dir output/unified-prototype/stage1/unified-final/100k

node scripts/prototype_checks/check-unified-contract.cjs output/unified-prototype/stage1/ui-compact output/unified-prototype/stage1/ui-compact/cmetrics-prototype.html
node scripts/prototype_checks/check-unified-contract.cjs output/unified-prototype/stage0/scale-1k output/unified-prototype/stage1/unified-final/1k/cmetrics-prototype.html

uv run python -m scripts.prototype_checks.run_baseline \
  --unified-report output/unified-prototype/stage1/ui-compact/cmetrics-prototype.html \
  --unified-report output/unified-prototype/stage1/unified-final/1k/cmetrics-prototype.html \
  --unified-report output/unified-prototype/stage1/unified-final/10k/cmetrics-prototype.html \
  --unified-report output/unified-prototype/stage1/unified-final/100k/cmetrics-prototype.html \
  --input-dir output/unified-prototype/stage1/ui-compact \
  --input-dir output/unified-prototype/stage0/scale-1k \
  --input-dir output/scale-10k --input-dir output/scale-100k-full \
  --samples 20 --startup-runs 3 \
  --browser '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --output-dir output/unified-prototype/stage1/chrome-156-unified
```

重新测量须换输出目录，不覆盖已有 `results.json`。

## 留存

- [统一 UI 原始证据](../assets/stage1-unified-chrome156.json)：输入／产物／源码摘要、构建数据、全部逐次样本、契约和 RSS 时间序列。
- [阶段 1 源码快照](../assets/stage1-source.tar.gz)：25 个源码／锁文件逐一匹配正式测量的 SHA-256；供后续阶段修改后仍可还原实验。其余仓库基线为 `da6642a`。
- [容量查询修复实验](../assets/stage1-query-full.json)。
- `output/unified-prototype/stage1/chrome-156-unified/`：逐命令记录、截图、profile 与分项样本。
- `output/unified-prototype/stage1/ui-legacy-regression/`：既有完整 UI 回归。

## Answer

阶段 1 文件与目录链路及首次 100k 测量完成。进入阶段 2：全部明细类型、匹配、超限、未知、重数和完整统计核验；阶段 3–5 尚未完成。
