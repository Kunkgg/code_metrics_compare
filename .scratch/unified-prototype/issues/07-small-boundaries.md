# 07 小规模边界、受限状态与需求追溯

Type: task
Status: resolved

## 问题与结论

沿用同一三页原型，从真实落盘输入核验阶段 2–4 的剩余异常、失败和返回行为。代码仍为 `spike/unified-prototype` 上的一次性原型；本记录不等于满规模、长时或跨平台验收。

本轮没有修改任何 Golden 输入、业务数值或排序预期，没有修改 `docs/PRD.md`、`docs/ARCHITECTURE.md`，没有建立正式产品目录。

## 实际修复

- 零分母：概览、分析标题、全部指标与静态概览统一显示“不适用”，任一侧不适用时差值为“—”。保留输入中序列化的零值，不改写业务数据。
- JSON 未知值：文件三列与函数两项度量新增有效位；整数物理占位不再被解释为业务零。未知向范围合计、祖先目录聚合和必要证据传播。
- 未知阈值：真实 JSON 的 `null` 不再导致构建异常；五类超限均标记受限，不给确定进出或净影响。
- 正常场景异常传播：构建保存独立 `integrity` 原因，包括明细未知、汇总复算冲突、目录覆盖、工具版本与路径映射限制；三页和静态消费相同原因。原始汇总及可读的两侧值保留。
- 组合异常：同名歧义、未知和阈值变化可同时保留；概览不会把未知文件归为增长、减少或无变化。
- 注入：模板只进行一次占位替换；指标名称及计算说明的输出补齐转义。CSP 阻止事件执行仍不足以视为通过，检查同时禁止恶意 DOM 节点生成。
- 字典：路径／函数名原先以换行分割，含换行数据导致数值列索引错位；改用显式 `dictionaryEncoding=json` 的 JSON 数组，保留旧格式读取兼容，不按首字符猜测。

## 需求追溯

| 需求 | 本轮证据与既有补充 | 核验边界 |
|---|---|---|
| U01 | `check-unified-workspace.js`，20 指标、两组各 10 项、14 项过程数据、三页切换 | 实际 Chrome DOM；原有 34 个汇总行含最大值 |
| U02 | workspace 方向空选／全选；overview/anomalies/edges 原检查；真实异常 browser 检查 | 异常卡片保留；净零超限进出仍分别可达 |
| U03 | `check-unified-unchanged.js`，13 项 | `moved` 代码行 18→18，位置 L50→L250、复杂度 3→9；不混入当前度量变化，原始证据可达 |
| U04 | 独立有理数净影响 722 项；workspace 页外贡献与返回 | 12 项、完整范围、53 页、抵消项与标尺；不把 Node 耗时当 DOM 性能 |
| U05 | 三页／静态阈值 173 项，零分母 114 项，未知阈值 294 项；真实异常 73／81 项 | 严格 `>`，阈值变化保留可靠明细，净影响受限；版本／映射受限独立于正常数值异常 |
| U06 | 文件／目录原 31 项及完整查询契约 45 项；resilience 22 项 | 全范围查找；确定性延迟旧成功／旧失败到新响应之后；输入和错误文本注入 |
| U07 | `check-unified-records.cjs` 与 evidence-complete 浏览器 251 项 | 76 页数据、四类重复证据每侧所有页、搜索、多组交叉、下钻与完整返回 |
| A01 / AT-01 | 文件／目录原检查、目录精确下钻、证据完整成员返回 | 净零内部变化及聚合；不以 Top N 代替完整明细查询 |
| A02 / AT-02 | 批准业务 Worker 1,524 项；unchanged；原记录 Worker 8 项 | 唯一匹配、原值、定位；同名函数每侧 45／47 条、各三页完整保留 |
| A03 / AT-03 | evidence 原 99 项与浏览器 251 项 | 两侧独立原 ID 组、未增长关联文件、片段／整文件成员跳转、源指标到头文件切换返回 |
| A04 / AT-04 | 真实异常构建及 browser；完整目录成员分页 | 申报数 3 与恢复数 2 分别显示，不含后代文件；覆盖原因在正常场景可见 |
| A05 / AT-05 | local/comparison 两组、未知阈值、静态与三页受限原因 | 明确未知、汇总冲突、版本／路径映射和影响范围；真实 Cmetrics 版本适配仍留内部 P4 |

## 独立重放

在仓库根目录：

```bash
uv run python -m scripts.prototype_checks.run_unified_boundaries --output output/unified-prototype/next-small-replay
node scripts/prototype_checks/check-compact-anomalies.cjs output/unified-prototype/next-local-replay
node scripts/prototype_checks/check-compact-anomalies.cjs output/unified-prototype/next-comparison-replay --comparison
node scripts/prototype_checks/check-compact-unknown-threshold.cjs output/unified-prototype/next-threshold-replay
node scripts/prototype_checks/check-compact-dictionary.cjs output/unified-prototype/next-dictionary-replay
node scripts/prototype_checks/check-unified-records.cjs
node scripts/prototype_checks/check-unified-impact.cjs
```

脚本自行生成专用夹具／复制批准输入，默认故事从确定种子重新生成并执行 L0–L3，不依赖历史故事目录。浏览器回放使用独立 agent-browser session，保存原始命令响应；小规模边界回放在断网状态执行。错误注入是受控故障探针，不修改扫描输入。

## 测量修正

旧 `check-unified-workspace.js` 连续重选当前指标，事件处理器会直接返回；这些热样本混入未发起查询的点击与等待。历史 `resume-*` 不覆盖，但不能据此宣称实际查询 P95 通过。本轮脚本先切离当前指标，再计时切回，确保每次任务实际请求 Worker。阶段 5 脚本采用同一原则，计时到 DOM 更新及后续两帧。

`check-threshold-changes.cjs` 中两条旧技术断言也与已批准实现不一致：目录未申报侧已有恢复成员数，不应要求 delta=null；同名函数按侧汇总的 6−3 应为 3，但仍不推断逐函数进出。另修正其独立目录夹具“申报3、实际2”的无意覆盖冲突。仅修正技术检查，不修改任何 Golden。

## Comments

最终独立回放：`output/unified-prototype/next-final-validated/results.json` 全部通过（概览方向矩阵、三页阈值 173 项、零分母 114 项、当前位置／其他度量 13 项、故障／并发 22 项，及初始化／运行故障重试、脚本移除静态、路径／名称／指标名称注入）；完整 pytest 484 项通过。实际查询 20 次热样本另见 `next-workspace-inspect.json`，20 项 P95 范围 118.4–176.1 ms；该小规模记录形成于最后一项概览分类修复前，修复后另跑完整概览方向检查，不将其扩大为最后源码的满规模性能结果。

原始产物位于 `output/unified-prototype/next-*`。构建、字典、未知阈值记录含输入／HTML／Worker 摘要；边界回放含源码摘要与浏览器版本。新增失败输出及无法确定结果的浏览器命令保留，不计通过；成功重放另存目录。

- 相关原始失败记录：`next-zero-red.json`、`next-template-red-valid.txt`、`next-boundaries-verified-run.txt`、`next-unknown-threshold/newline-probe/dictionary-evidence.json`。模板最初一次探针缺少完整指标名称映射，触发 KeyError；该无效探针不作缺陷证据，后续使用完整映射回放旧替换逻辑才确认二次替换缺陷。
- 另修复概览方向：两侧序列化平均圈复杂度都为 6.39，原始分子／分母略有增长；显示值保持原样，方向仍归增长。旧技术检查把这类情况归无变化，已按 spec 修正；批准 Golden 不变。

容量矩阵与完整进程树 RSS／长时在 [06-capacity.md](06-capacity.md) 继续。Windows Chrome／Edge 未取得环境，macOS Edge 未安装，均未测，不能宣称完整验收通过。
