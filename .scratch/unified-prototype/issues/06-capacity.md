# 06 满规模容量测量准备

Type: task
Status: claimed

## 当前结论

阶段 5 正在实际执行，**尚未验收**。十组 100k／1m 输入已就绪；本 pane 的最终运行入口为 `run_unified_matrix.py`，输出 `output/unified-prototype/stage5-final-v1/`。运行顺序为十组 20 冷／20 热 → 独立完整序列 oracle → full-mixed 1,800 秒主动长时。下方准备和校准记录保留历史，不将等待目录或构建后源码有变化的报告混入最终结果。

容量测量工具、顺序矩阵驱动及完整查询／净影响／证据／生成管线验证工具分别记录实际验证状态；未修改 Golden、PRD、ARCHITECTURE 或冻结的原型运行源码。当前唯一主动修改 agent 已接手旧 pane；后台矩阵 PID 98850 保持运行，测试工具的小规模校准交给独立 subagent。

## 调查及输入准备

已读取仓库 AGENTS.md、spec、阶段 0／1 记录、run_baseline.py、prototype_scale_data.py、compact_report.py、prototype.py 及容量构建器。复用现有 Browser 的离线 file:// 驱动、注入探针和命令归档；替换为 `capacity-<随机标识>` 独立 session 和逐样本递归进程树采样，不连接主 agent 的 `unified-next` 或默认 session。

历史 `output/scale-100k-{full,low,wide}` 存在，但仍使用旧重复文件字段。直接用当前紧凑构建器处理 full 实际报 `KeyError: 'file_duplication'`，失败证据保留在 `output/unified-prototype/stage5-capacity-calibration/`。历史输入未改写；用当前生成器在新目录重新生成。

首轮准备的以下六组均实际生成，并从两侧原始 JSON 独立计算文件数、普通函数数（排除末尾最大复杂度汇总记录）和文件有效代码行之和。每侧均 **100,000 文件／1,000,000 函数**，满足每侧至少 25,000,000 代码行；输入 SHA-256、配置与规模核验写入 `output/unified-prototype/stage5-data-inventory.json`。

| 输入目录（均在 output/unified-prototype/ 下） | 总变化率 | 分布 | 存续修改文件 | 每侧进／出文件 | 基线保留率 | 两侧代码行 |
|---|---:|---|---:|---:|---:|---|
| stage5-input-full | 100% | mixed | 98,000 | 2,000 | 98% | 180,237,783 / 182,237,783 |
| stage5-inputs/low-mixed | 1% | mixed | 1,000 | 0 | 100% | 180,237,783 / 180,257,783 |
| stage5-inputs/mid-mixed | 30% | mixed | 30,000 | 0 | 100% | 180,237,783 / 180,837,783 |
| stage5-inputs/full-wide | 100% | wide | 100,000 | 0 | 100% | 180,237,783 / 182,237,783 |
| stage5-inputs/full-deep | 100% | deep | 100,000 | 0 | 100% | 180,237,783 / 182,237,783 |
| stage5-inputs/churn-mixed | 100% | mixed | 80,000 | 20,000 | 80% | 180,237,783 / 182,237,783 |

统一 seed 为 `20261021`，大重复组 10,000 文件、同名歧义比例配置 0.2、长名称开启。生成器没有真实逐代码行文本模型；有效代码行是扫描输入中的数值，不等同于物理生成这些源文件。

脚本 `--matrix` 给出 **1%／30%／100% × mixed／wide／deep** 的九组正交生成命令，集合进出另组、200k／2m 探索另组。上述六组是首轮已落盘的代表组；后续已补齐九组正交矩阵＋churn，见文末。200k 探索仍未生成或运行。100% mixed 的零进出正交组现位于 `stage5-inputs/full-mixed`，不得用保留率 98% 的历史校准组替代。

## 测量脚本行为

- 默认 20 个独立冷 profile，会话内每任务首个测量样本单列；首个会话另取每任务 20 次热样本、默认持续 1,800 秒主动重复操作。逐批刷新 results.json，失败保留 error、进程树与浏览器命令。冷会话启动和每个交互任务分开记录。
- 20 指标走真实 DOM 事件；每次先切到另一指标再切入目标，避免当前 `analysis-type` 对已选指标直接返回的空操作。文件查询独立覆盖首页、第 51 页、末页和全范围路径搜索，不调用历史 bench，也不把首页摘要当全量查询。
- 四项文件任务用完整两侧原始路径并集独立核对结果总数、页码、路径升序以及当前页全部 ID。其余 20 指标当前仅核对指标状态与当前页数量，**没有完成大规模完整业务序列的独立预期核验，不能算性能通过**。
- 交互计时从页面事件开始，包含 Worker 请求、DOM 提交及后续两帧；Python／agent-browser 工具启动耗时不计入页面交互。OS 磁盘缓存没有清空。会话内前序任务可建立共享索引，所以“冷”仅代表干净 profile 内该任务的首次测量，不代表每类查询单独清空所有 Worker 缓存。
- 默认 nearest-rank P95，20 次为第 19 个有序样本；少于 20 次仅保存范围，最终脚本不输出 P95。所有任务保存逐次 elapsedMs、total、page、ids。无论观察速度如何，整体状态始终 `measured-not-accepted`，须另外完成完整业务和平台验收。
- 浏览器以专用 profile 定位根进程，对根及所有递归后代逐样本记录 PID、PPID、进程名、创建时间、RSS 和读取错误；以该独立会话加载报告前的空页面最后五个有效样本中位数计算差分。不会只读父进程。构建使用明确子进程 PID 的相同递归采样器，构建本次实际只有一个 Python 进程。
- RSS 目标间隔 100ms，保存实际最大间隔与完整时序；共享页会重计，枚举有竞态，采样间隙瞬时峰值可能漏采。长时额外登记首／末各至多 50 个样本的中位数，不自动认定无内存泄漏。
- 保存输入／HTML／源码／uv.lock SHA-256，CPU／物理内存／OS／Python／Node／uv／agent-browser 和实际浏览器完整版本。最终脚本增加构建后、测量后源码摘要及变动标记，方便并行修改稳定后重建；外部 `--report` 的摘要不能证明该 HTML 来自当前源码。
- 构建时间仅包含紧凑打包，不包含生成数据与完整 L1／L2／L3。输出必须是全新 `output/unified-prototype/` 子目录，避免覆盖历史证据。

## 本机实际校准

证据：`output/unified-prototype/stage5-capacity-calibration-v2/`。完整原始结果为 results.json，构建日志 build.log，构建全树时序 build-rss.json，浏览器命令和时序在 cold-01/。校准执行时的脚本 SHA-256 为 `9fc62d377253febe03c615a3daba23c5c99d270251cfb7b3735a2eeb8ec4b246`；此后仅修订工具记录，包括源码变动标记与不足 20 次不输出 P95，**没有覆盖重跑旧证据**。

环境：Apple M5／16 GiB，macOS，系统 Chrome **156.0.8078.80 headless**（由 UA-CH fullVersionList 获取），与历史阶段 0／1 Chrome 156.0.8078.48 不同。其余环境详情保存在 results.json。

| 项目 | 实测 |
|---|---:|
| 紧凑 HTML | 14,558,664 bytes，约 13.88 MiB |
| HTML SHA-256 | `f7fe40330b843f22408a93dedc1424f18d042e68376efb0e80f38b8af0f0eb8a` |
| 构建器内部打包耗时 | 21.747 s |
| 独立子进程墙钟耗时 | 21.839 s |
| 构建器 OS 峰值 RSS | 2,233.8 MiB |
| 完整构建进程树采样峰值 | 2,274,312,192 bytes，约 2,168.95 MiB |
| ready 标记＋两帧 | 546.9 ms，单次 |
| 浏览器空页面树 RSS 基线 | 1,563,099,136 bytes，约 1,490.69 MiB |
| 浏览器进程树峰值 | 2,263,613,440 bytes，约 2,158.75 MiB |
| 浏览器空页面差分峰值 | 700,514,304 bytes，约 668.06 MiB |
| 浏览器采样最大覆盖进程数 | 12 |
| 浏览器采样读取错误 | 0 |
| 构建／浏览器实际最大采样间隔 | 175.03 / 175.05 ms |

实际只执行 **1 冷会话／每任务 1 热样本／0 秒长时**。20 指标各单次首次切入约 87.5–474.9 ms，热切入约 80.7–429.2 ms。四项文件任务各次结果均与独立预期相符：首次切入 113.1–182.6 ms，热操作 148.0–167.5 ms。页面无脚本错误和 HTTP(S) 请求。

这些是单样本工具校准值，**不是 P95，也不关闭 10 秒／1 秒／3 秒／2 GiB 或完整生成门槛**。校准旧版结果中的 p95Ms 字段仅有单样本，不应按验收 P95 解读；最终脚本已改为样本不足时写 null。

本次校准期间主 agent 修改 prototype.js／prototype.py，之后还计划修改异常传播。校准结果由保存的源码摘要和 HTML 摘要定位，不代表最终代码状态；最终构建后新增的源码前后变动检查尚未通过第二次实际构建验证。

## 待最终源码稳定后的可执行命令

```bash
# 查看完整变化／分布／集合进出／探索矩阵，不启动浏览器。
uv run python -m scripts.prototype_checks.measure_unified_capacity --matrix

# 以下默认实际重新构建HTML；输出目录必须不存在。
# 执行20个冷会话，每任务20次热样本和至少30分钟长时使用。
uv run python -m scripts.prototype_checks.measure_unified_capacity \
  --input-dir output/unified-prototype/stage5-inputs/full-mixed \
  --browser '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --output-dir output/unified-prototype/stage5-final-full \
  --cold-runs 20 --hot-samples 20 --soak-seconds 1800

# 再对stage5-inputs下各组用独立新输出目录执行同一入口。
# 需要headed证据时附加--headed；不要合并headed/headless样本。
```

Windows 可换成本机 Chrome／Edge 可执行文件路径，读取复制的报告和原始输入，用新输出目录运行同一入口；脚本使用 psutil，无 Unix resource 直接依赖。**Windows Chrome、Windows Edge 均未取得执行环境、均未测**；macOS Edge 也未测。跨平台入口准备不等于 Windows 已验证，Windows 缺失继续阻塞最终兼容验收。

## 验证与剩余范围

最终脚本 Ruff 检查／格式、Pyright、内嵌 JS 的 Node 语法检查通过。另检查不足 20 次不计算 P95、20 次 nearest-rank 为第 19 个样本。真实 100k 构建和 24 任务校准如上，无另外新增测试文件。

仍需执行完整矩阵、20 冷／20 热、至少 30 分钟主动长时、200k 探索、Windows Chrome／Edge 和 macOS Edge／headed；补完整大规模业务预期、函数名称重搜索、目录及证据集合多页操作、净影响精确下钻等重任务和完整报告生成校验管线。此脚本是可执行容量测量基础，不能独自覆盖全部产品验收。异常／断网专项由主 agent 的 resilience 脚本负责，容量记录不替它宣称通过。

## 完整矩阵准备（追加执行）

用户追加要求先扩齐九组变化／分布矩阵＋churn，源码仍由主 agent 和打包 agent 修改，**收到源码冻结通知前不最终构建**。本次只生成缺失输入、核验和准备执行命令，没有新增构建／浏览器校准，也没有覆盖首轮证据。

`output/unified-prototype/stage5-inputs/` 现有十组，总占用约 **7.6 GiB**；开始时可用磁盘约 327 GiB，空间充足。本次补充 low-wide、low-deep、mid-wide、mid-deep、full-mixed；其余五组原样复用。历史 `stage5-input-full` 保留为 2% churn 校准输入，不混入九组正交矩阵。

| 变化率 | mixed | wide | deep | 各组存续修改数／进出数 |
|---|---|---|---|---|
| 1% | low-mixed | low-wide | low-deep | 1,000／0 |
| 30% | mid-mixed | mid-wide | mid-deep | 30,000／0 |
| 100% | full-mixed | full-wide | full-deep | 100,000／0 |
| 100%＋大量集合进出 | churn-mixed | — | — | 80,000／每侧 20,000 |

十组均逐侧读取原始 JSON，核对实际文件数、普通函数数、代码行总和、路径并集、配置和存续修改计数。每侧均 **100,000 文件／1,000,000 普通函数**，基线代码行均 180,237,783，当前侧依次为 180,257,783（1%）、180,837,783（30%）、182,237,783（100% 和 churn）；全部超过每侧 25m 要求。九组正交组基线保留率 100%，churn 组为 80%。此核验不替代完整 L1／L2／L3。

新增独立产物：

- `output/unified-prototype/stage5-matrix-inventory-v1.json`：十组原始明细规模、矩阵配置核对、两侧输入与 manifest SHA-256、生成器源码摘要。未覆盖首轮六组 inventory。
- `output/unified-prototype/stage5-matrix-preparation-v1.log`：本次五组实际生成日志，各组生成及写出约 7.15–8.39 s，未运行校验器。
- `output/unified-prototype/stage5-matrix-plan-v1.json`：状态 `prepared-awaiting-explicit-source-freeze`，十组必测和单独延期的 200k 探索条目。每组记录输入路径、可复用状态及 `measurementAfterFreeze` 命令数组；已有输入的生成命令为 null，避免误覆盖。

脚本 `--matrix` 的名称已与实际目录统一；现在只打印计划，绝不触发构建／浏览器。每组 `measurementAfterFreeze` 显式指定 20 冷／20 热，**仅 full-mixed 指定 1,800 秒长时，其余九组为 0 秒**。统一输出父目录预留为 `output/unified-prototype/stage5-frozen-matrix-v1/`，本次没有创建。200k 探索仍未生成或执行，不纳入十组必测执行。

性能记录进一步分开：

- `independently-checked-file-tasks`：四项文件任务独立核对总数、页码、完整排序所得的当前页全部 ID；未核验每个业务数值，不能称为所有文件业务断言通过。
- `metrics-awaiting-independent-full-sequence`：20 指标仅检查状态和当前页数量；即使保存的 P95 达标，也明确不计性能通过。

结果在 `summaries` 中逐任务标注 `correctnessCoverage`／`performanceGroup`，并另提供 `performanceGroups` 按冷热／长时分组的独立数组。整体继续保留 `measured-not-accepted`。脚本未把准备完成、样本数量充足或数量状态正确提升为完整正确性通过。

本次检查：Ruff 检查／格式、Pyright、JS 语法通过；验证十组计划的输入存在且生成操作跳过、所有必测组为 20 冷／20 热、仅 full-mixed 为 1,800 秒、少于 20 次不输出 P95、20 次 nearest-rank 返回第 19 个样本、文件与指标分组标识互不混淆。新增源码摘要变动标记与性能分组还需冻结后实际运行验证。

冻结通知后按 plan 内 `role == required-100k-matrix` 的十组命令依次执行，每组创建新的构建与测量产物；不使用 `--report` 复用旧 HTML。执行时确认每组构建／测量前后源码摘要稳定，并跨组核对相同源码摘要；发生变动则保留该组证据并停止后续验收。Windows Chrome／Edge 和 macOS Edge 仍未测，Windows 环境缺失继续阻塞兼容验收。本次没有 commit。

## 冻结前命令与资源复核

用户已另派专门 agent 编写 `check-unified-scale-oracle.cjs`。容量 agent 随即撤回尚未接入的重复 oracle 实现并终止其校准进程；容量脚本继续只负责性能、进程树资源及长时。`output/unified-prototype/stage5-oracle-calibration-v1/ABORTED.json` 明确标记该次部分输出为 `aborted-not-evidence`，不用于任何通过结论，也不替代专门 oracle 证据。未修改 Worker。

十组 `measurementAfterFreeze` 命令已再次核对：输入文件均存在、变化／分布／churn 配置匹配、浏览器可执行文件存在、预留输出目录均尚不存在；每组 20 cold／20 hot，只有 full-mixed 为 1,800 秒主动长时。当前容量脚本摘要仍与已保存的 plan-v1 一致。工具依赖 agent-browser、Node、uv 均可定位。

本次磁盘可用约 322 GiB；16 GiB 物理内存当时可用约 5.0 GiB。资源和命令逐组核验结果保存为 `output/unified-prototype/stage5-matrix-preflight-v1.json`，其中保留实时内存／交换区／磁盘字节数与采集时间；这些是准备阶段快照，不是正式测量资源基线。源码冻结后各组顺序执行，独立 oracle 校验与浏览器性能测量分开运行，避免互相影响。

本次没有最终构建、没有新增浏览器样本、没有启动30分钟长时；等待主 agent 明确冻结通知。完整序列核验由专门 oracle 提供，容量结果现阶段仍把20指标列为仅时延／待独立核验，不自动提升为正确性或性能通过。Windows Chrome／Edge仍明确未测。

## 冻结后实际执行启动

用户已明确原型运行源码冻结（含 dictionaryEncoding=json 等修复），授权实际顺序执行十组20 cold／20 hot和 full-mixed 1,800秒主动长时。随后追加隔离安排：先只构建，等待“小检查完成”再启动浏览器；十组短矩阵先全部完成，再留出独立oracle窗口，之后单独执行长时。容量脚本仅增强测量入口，不修改任何原型源码。

新增观测超限停止机制：HTML >200 MiB、打包 >600秒／采样峰值 >8 GiB、ready >10秒、浏览器空会话差分采样峰值 >2 GiB，或足量样本的常用交互 nearest-rank P95 >1秒时，保存实际失败和已采样结果，停止该组。对20指标的时延超限可以登记失败，但不会因时延未超限而认定其业务正确。打包不含完整校验，低于门槛仍不能关闭完整生成验收。

首组已实际构建，证据在 `output/unified-prototype/stage5-frozen-matrix-v2/full-mixed/`：HTML 14,545,956 bytes，打包22.950秒，墙钟23.081秒，树RSS采样峰值2,591,145,984 bytes，最大采样间隔175.03ms，记录一次进程读取错误（详见build-rss.json，未掩盖为无误覆盖）。此时尚未启动浏览器。

短矩阵实际执行目录改为 `output/unified-prototype/stage5-frozen-matrix-v3/`，顺序：full-mixed、churn-mixed、full-deep、full-wide、low-deep、low-mixed、low-wide、mid-deep、mid-mixed、mid-wide。每组20 cold／20 hot，全部soak=0。full-mixed引用刚构建的v2 HTML，并在matrix-status.json中保存buildEvidence关联；两个执行目录的原型源码冻结摘要已逐文件一致核对。其余九组各自实际构建。v2已停止的等待进程没有浏览器样本，不当作一次失败性能实验。

执行器保存 `frozen-prototype-sources.json`，每组前后核对原型源码；源码变动则停止整个矩阵。各组独立失败保存后停止该组，未失败的其他组继续顺序测量。浏览器门禁文件为v3目录下的 `BROWSER-RELEASE`；明确收到“小检查完成”前不创建，不把等待时间计入浏览器时延。矩阵短测完成后状态为 `short-matrix-finished-awaiting-oracle-window`，不会自动并发启动长时。

## 接手续跑检查点

接手基点为 `b414a41`，分支 `spike/unified-prototype`。已读取交接文件、spec、术语表和阶段 2–4 收口记录。PID 98850 及其子进程仍活跃，没有重复启动矩阵。权威目录为 `output/unified-prototype/stage5-final-v1/`，历史 v2／v3 等目录保持原样。

接手时 low-mixed、low-wide、low-deep 各完成 20 冷／20 热；mid-mixed 正在运行。完成状态仍为 `measured-not-accepted`。正式浏览器采样期间不运行大规模 oracle、生成或其他浏览器，保持原型 runtime 与容量测量脚本冻结。矩阵随后自行顺序执行完整明细 oracle 与 1,800 秒主动长时。

容量脚本和矩阵驱动的 Ruff、格式检查、Pyright 已通过。新写的明细 oracle、12 项净影响、证据集合／浏览器，以及生成管线和汇总判定，分别交给独立 subagent 做轻量审查与小数据校准；尚未返回的验证不计通过。对应证据目录为 `output/unified-prototype/stage5-handoff-{oracle,impact,evidence,tools}-review/`。

分布口径修正：现有 wide 的每 bucket 约 8 文件、上层约 12,500 个直接子目录；mixed 的 src/bulk 约 33,333 个直接文件。当前输入不包含“100,000 个直属文件”场景。重复片段大组 10,000 成员、重复文件大组约 1,000 成员。200k／2m 尚未执行，Windows Chrome／Edge 与 macOS Edge 仍未测。

## Comments

接手后按指标将独立核验结果保存在产物目录，主记录只保留结论、失败和证据路径。完整查询／净影响／证据正确性未完成前，不根据时延单独认定性能通过。

净影响满规模验证工具小规模校准（subagent）：`check-unified-scale-impact.cjs` 修订后 12 指标、24 范围组合、136 个排名对象、96 次分页请求 0 失败；页数、分页对象数值、范围三类旧脚本漏检的故障注入全部检出，红绿案例退出码符合预期，独立预期聚合与相减改用 BigInt。未测：真实第 50/51 页、wide/deep 范围与满规模执行；小故事最大实际页数为 3。证据：`output/unified-prototype/stage5-handoff-impact-review/{review.md,review-summary.json}`。未改冻结 runtime。

已完成四组冷热采样独立复核（subagent，只读）：low-mixed、low-wide、low-deep、mid-mixed 共 4 组 × 29 任务 × 冷/热 232 项从原始 runs 重算，计数、nearest-rank P95、min/max 与工具输出全部一致，未发现工具判定错误，页面 runtime error 0；四组源码前后摘要一致（两个 changed 标记均 false）。当前最慢：cold `metric:lines_per_method` @low-wide P95≈647.3ms，hot `methods-absent` @low-deep P95≈649.4ms，均未超 1s 观测上限；任务级 100 条组-任务（20 指标 + methods-* 五类）未完成完整业务 oracle，不判性能通过；files-* 16 条已独立核验。限制保留：热样本集中于单一 run；OS 磁盘缓存未控制、冷查询共享索引；内存采样竞态 low-wide/mid-mixed run1 各 308/307 次（coverageComplete=false），最大采样间隔 250.1ms vs 目标 100ms；峰值增量最大约 1.17 GiB（low-deep）；soak 未执行。证据：`output/unified-prototype/stage5-handoff-sampling-review/{result.json,review.md}`。

完整查询 oracle 校准（subagent）：小规模正向 6 组共 1908 任务 0 失败（story-measured 366、scope-after 310、story-before/threshold-change-after/method-lines/empty 各 308），20 指标 / 10 type 的完整序列 SHA256、状态与范围计数、分页元数据/行/ID 及实测 DOM 回放全部一致；故障注入 8/8 变红（错误 DOM ID/总数/页码、HTML 摘要、输入摘要、非 normal 场景、type 映射、非法数值条件），未突变重序列化对照全绿。修复缺陷：扫描根目录无尾斜杠时被拒（threshold-change 组历史失败为修复前证据）；实测 58 条样本 56 含 DOM ID，2 条 methods-number（total=0）未采 ID 的限制逐条登记。脚本 `node --check` 通过，默认入口行为不变，驱动满规模调用不受影响。证据：`output/unified-prototype/stage5-handoff-oracle-review/{review.md,review-summary.json,negative-probes.json}`。未改冻结 runtime。

证据集合验证工具校准（subagent）：`check-unified-scale-evidence.cjs` 小规模 288 项 0 失败，无查询子集 84 项与浏览器绑定期望键集完全对齐（HTML/manifest SHA 独立复算）；validate-only 绑定通过；8 个负例全部拒绝；浏览器脚本静态检查 12 项通过；`measure_unified_evidence.py` Ruff/Pyright 通过。修订：proof 命令统一 `--max-old-space-size=6144`（full-mixed 每侧 349MiB JSON，与矩阵 oracle 同口径）。未测：小规模烟测与 full-mixed/full-wide 满规模（预计 proof 3×288=864 项、烟测 52 窗口、满规模 2×1040=2080 窗口、每组 52 项 P95），须待 PID 98850 全矩阵及长时结束后按 execution-plan.json 顺序执行。证据：`output/unified-prototype/stage5-handoff-evidence-review/{execution-plan.json,review.md,review-summary.json}`。未改冻结 runtime。

生成管线与汇总判定工具校准（subagent）：`run_unified_pipeline.py`、`summarize_unified_matrix.py` CLI `--help` 无副作用；汇总合成校准 18/18（修订前副本 7/18，11 项负向被拦截或修复崩溃）；管线接口注入 7/7（含超时进程组清理）；181 文件真实运行 0.698s，RSS 2 次读取竞态保留并如实置 `withinTimeAndMemoryLimits=false`；summarize CLI 冒烟 exit 0，门槛未通过如实输出（localShortGatesMet=0、compatibilityAccepted=false）。Ruff／Pyright／py_compile 通过（修订前 Pyright 1 error）。满规模 full 100k 生成管线与 stage5-final-v1 汇总须在矩阵及 1,800 秒长时结束后按 execution-plan.json 顺序执行。证据：`output/unified-prototype/stage5-handoff-tools-review/{execution-plan.json,review.md,review-summary.json}`。未改冻结 runtime。

## 首轮流跑结果（自动接续 agent 盘点）

证据：`output/unified-prototype/stage5-handoff-matrix-final/summary.json`、`stage5-handoff-evidence-exec/`、`stage5-handoff-autoexec/{report.md,report.json}`。矩阵总时长约 6,732 秒，驱动正常退出，源码稳定性标记干净。

- 短测 8/10 通过；full-wide、full-deep 失败（`CDP response channel closed`）。
- 完整 oracle 已测组全部通过（含 full-wide，完整序列 SHA256 一致）；low/mid/full-deep 三组 oracle 因 Node `ERR_STRING_TOO_LONG`（超 V8 字符串长度上限）无法完成，属 oracle 工具侧限制，deep 组业务正确性尚未判定。
- soak full-mixed 失败：266.3s/1800s 提前断连；RSS 1.729→1.792 GiB 已登记，不满程不得出长时资源结论。
- 证据计划执行 4/6：small-story-proof 288/0、小规模烟测、full-mixed-proof 288/0 通过；full-mixed-browser rc=1（冷 1/20、热 15/20 CDP 断连）按非零即停规则中止，full-wide-proof/browser 未执行；工具计划按规则跳过。
- 四例 CDP 断连集中于满规模浏览器高压场景（full-wide/full-deep 短测、full-mixed soak、full-mixed 证据浏览器），待诊断是浏览器进程崩溃（如渲染 OOM）还是自动化通道问题；修复后重跑失败项。

Windows Chrome/Edge 与 macOS Edge 仍未测；上述失败未修复前，阶段 5 不得宣称任何满规模通过。

### CDP 断连诊断（subagent，只读）

四例断连定位为 agent-browser daemon 0.41.0 ↔ Chrome 156 DevTools WebSocket 非确定性断开（H1：0.41.0 源码中该错误唯一现实路径是 reader loop 退出并清空 pending）；次候选 H2 为 Chrome 156 DevTools 回归（10-29 升级后首个 full 批次触发，时序吻合但无升级前同规模对照）。渲染 OOM／浏览器崩溃／系统 jetsam 均排除：4/4 案例页面 renderer pid 全程稳定，断连时完整树 RSS 1.72–2.36 GiB，DiagnosticReports 无 Chrome 条目；失败为概率性（同窗口 full 量级约 4/58 会话），失败命令均为对 14.3 MB 报告页的 TASK_JS eval，实耗 5.8–8.8s 低于 30s 超时。结论：属测量自动化通道问题，非原型页面失败。最小复现（40 冷＋daemon debug 及 Chrome for Testing 155 对照）已写入分析，待 deep oracle 修复结束后顺序执行。证据：`output/unified-prototype/stage5-cdp-diagnosis/{analysis.md,evidence.json}`。

### deep 组 oracle 修复（subagent）

根因：deep 输入 `baseline/current.json` 约 567,702,773 字节（纯 ASCII），超 V8 单字符串上限 536,870,888 字符，oracle 整读 JSON 即 `ERR_STRING_TOO_LONG`（<0.5s 快失败）；full-mixed 输入 366MB 在限内放矩阵成功，完全解释 3 败 1 成。修复（仅 `check-unified-scale-oracle.cjs`，+87/−18）：新增 `RawJsonScanner`——16MiB 分块 `readSync` ＋字节级 JSON 状态机按自包含成员/元素切片流式消费；修复前核对 Worker 协议，完整序列 SHA256 为 oracle 进程内自洽口径，html／inputs 摘要走既有流式 `digestFile`，字节序不变。等价性：小夹具×4 ＋ full-mixed 366MB 真实 differential（100 万元素全扫、抽样 1100 恒等）全绿；differential 过程另修扫描器两 bug（块内偏移与绝对位置混用、嵌套迭代共享缓冲污染）。前任“depth 语义错误”线索证伪（目录聚合与 Worker uiMembers 语义逐条一致）。结果：low/mid/full-deep 各 334/0 通过（full-deep 短测虽败但 HTML artifact 完整、实测绑定断言全过），full-mixed 回归 334/0 默认行为未破坏。至此十组完整 oracle 全部通过（矩阵内 7 组＋本修复 3 组）。证据：`output/unified-prototype/stage5-deep-oracle-fix/{FIX-NOTES.md,PROGRESS.json,result-summary.json,red-low-deep.stderr.log,diff-full-mixed-baseline.log}` 及各绿证据目录。未改冻结 runtime。

### CDP 复现判定（subagent）

分支 A（Chrome 156，40 冷）：cold-28 第 8 条 TASK_JS eval 复现 `CDP response channel closed`（1/28），daemon 同秒日志 `[cdp] WebSocket Error: Connection reset without closing handshake`，进程树稳定；分支 B（Chrome for Testing 155）：cold-16 同位置同错误同日志（1/16），模式逐字一致。判定：H1 成立且定性为 daemon↔Chrome DevTools WebSocket 被 IO 层 reset（非 Close 帧）；H2 不成立（155/156 均触发，非版本特异）；H3（daemon 内部问题）升为首要待查。重跑策略：换浏览器版本无效，须在测量层加会话级重试（失败会话丢弃、新会话补足、单独标记并保留失败证据）。证据：`output/unified-prototype/stage5-cdp-repro/{verdict.md,verdict.json}` 及 A/B 分支 daemon 日志。复现均为诊断证据，不计入性能验收。
