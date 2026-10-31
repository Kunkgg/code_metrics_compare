# 03 全部明细与状态

Type: task
Status: claimed

## 范围

沿用阶段 1 的同一 UI、紧凑构建、Worker 快照与完整范围／当前页边界。完成 20 个指标对应的文件、函数、重复、危险调用、冗余块和超大目录查询，不引入第三套 UI。

## 工作项

- 按原始键建立唯一匹配与歧义；行号变化不用于跨版本猜测配对。同文件同名函数分别按侧汇总，提供集合总量差值、两侧记录数和“同名函数可能混淆”提示；数据已获整体浏览确认，实现修订仍待阶段验收。
- 所有类型支持全范围路径／名称、数值条件、类别、稳定排序与任意页。
- 两项源重复明细排除头文件；完整聚合不受页和表内条件影响。
- 仅阈值不同（`threshold-change`）仍比较超大明细：在身份映射、数值和覆盖可靠时，按各侧阈值严格 `>` 判定，展示可确定的新增／退出超限、两侧数值及有意义的观测差值，明确提示“阈值变化，清单进出和数值变化不证明代码恶化或改善”。版本、映射、未知、歧义与覆盖限制继续适用；详情放开不等于净影响分解放开，阈值不可比等情形仍不输出确定净影响或排名。未知不能补零。
- 所有对外业务浮点数（含均值、百分率、密度及 `_kloc`、差值和净影响）统一按十进制 Half-Up 四舍五入至两位小数，不能截断；内部保留未舍入分子／分母及精确值用于计算、比较、分类、筛选、排序和聚合，不能用显示舍入值分类。允许显示分项之和与显示总量存在舍入尾差。
- 危险调用按文件／名称／行去重；冗余块保留同起点条目重数。
- 核验全部 33 项汇总及最大值，不能用旧26项自检替代。
- 更新独立原始输入预期、异常夹具与浏览器回归，在100k重测函数查询和资源。

## 原登记的 14 条失败断言（本轮已修复）

以下为修复前记录，保留用于追溯。

这里的 14 指参考 UI 对照 golden 的失败断言数量，集中在下列三类实现问题；同一问题会影响多个列表或过滤结果。当前检查执行 `prototypes/ui/prototype.js` 的业务函数，不代表完整 Worker 或浏览器验收。

| 实现问题 | golden 要求 | 当前行为与具体影响 |
|---|---|---|
| 函数排序 | `path:asc` 先按文件路径，同路径再按函数名称排列。 | 当前先按函数名称排列。例如 `src/b.c:moved` 插在多条 `src/a.c` 函数之间，导致完整列表和无变化列表的顺序不符。 |
| 同名函数集合比较 | 同文件同名称分别汇总两侧值，比较集合总量，同时保留歧义和提示。 | `repeat` 基线两条为 10+20，当前一条为 25，应得到 30→25、差值 -5；当前两侧值和差值仍为 null，也没有完整比较依据与中文混淆提示。该行未进入减少过滤，结果数量预期 4、实际 3。 |
| 两侧函数记录数 | 每行返回 `beforeCount`、`afterCount`：普通存续为 1→1，单侧新增为 0→1，同名集合示例为 2→1。 | 当前参考 UI 未完整返回这些字段。即使 `new_only` 的代码行 0→15、差值 15 正确，其记录数仍缺失，固定行投影因此失败。 |

失败断言分布如下：

| golden 数据组 | 数量 | 涉及断言 |
|---|---:|---|
| `huge-complexity` | 2 | 完整列表、无变化过滤结果的顺序。 |
| `huge-method` | 2 | 完整列表、无变化过滤结果的顺序。 |
| `method-complexity` | 2 | 完整列表、无变化过滤结果的顺序。 |
| `method-lines` | 8 | 完整列表；新增、退出、增长、减少、无变化过滤；减少结果数量；同名集合及提示。 |

逐条登记见 [business_known_gaps.json](../../../tests/business_known_gaps.json)；业务预期及手算说明见 [method-lines](../../../tests/fixtures/golden/method-lines/README.md) 和 [Golden Dataset 索引](../../../tests/fixtures/golden/README.md)。测试入口是 [test_golden.py](../../../tests/test_golden.py)，通过 [check-business-fixture.cjs](../../../scripts/prototype_checks/check-business-fixture.cjs) 调用参考 UI。

验收修复已落实：路径优先排序、按侧同名集合总量及记录数已接入参考 UI 和 Worker，14 项旧 `strict xfail` 登记已清空。业务预期未改写。

原另有一条排序预期冲突，现已获用户追加确认并消除：`threshold-change / hugeMethod all` 按默认 `path:asc` 将 `above/a.c:equal` 放在 `above/b.c:above` 前。仅交换两行顺序并更新审核范围及业务摘要，字段值、其他业务预期和两侧输入不变。最新完整 pytest 484 项、Worker 1,524 项全部通过；下方保留确认前测量历史。

## 边界

用户本轮恢复原型验证；先做阶段 2–4 小规模功能与测量，100k 重测后置到统一性能阶段。以下数据批准范围保持不变：已获用户确认“已人工浏览、整体场景和口径无异议”，与原已明确 OK 的 `empty`、`comments-only` 合计 15 组，纳入 [Golden Dataset](../../../tests/fixtures/golden/README.md)，metadata 标记为 `approved`，业务内容不变。批准范围仅为上述整体浏览确认，不据此认定逐值复核完成，也不等于实现验收。原始审核意见保留在 [review-issues.md](../../../tests/fixtures/golden/review-issues.md)。Schema／生成约束已迁入 `tests/fixtures/validation/`。

12 项净影响在阶段 3，所有关联证据集合分页在阶段 4。仍保留已有全部入口；不以未接入、异常或仅当前页冒充确定的全量结果。

## 实验记录

本轮已恢复执行，详情见下方 Comments。阶段尚未宣称完成；Windows／Edge、满规模与长时矩阵仍待执行。

## Comments

本轮恢复后的阶段 2：

- 修复参考 UI 原 14 条函数排序／同名聚合／记录数差距，清空过期 xfail；补齐 Worker 对应实现。
- 修复紧凑构建根目录自身路径、超大目录未申报侧的恢复值；扫描申报值与恢复值分别保留。
- 新增 `scripts/prototype_checks/check-worker-business.cjs`：15 组输入构建真实内嵌 Worker，逐页对照批准预期，并逐字段核对全部序列化汇总与最大值。每任务保留 20 次 Node VM 样本，明确不代替 DOM 性能。
- 浏览器文件任务原检查更新为函数已接入；小规模 Chrome 31 项通过。新增 `check-unified-workspace.js` 验证三页、全部 20 个指标、概览多选与有界 DOM；修改后重新执行的证据见后续记录。
- 初次完整 pytest：483 通过、1 失败；唯一失败为上文排序预期冲突。保留真实失败，不修改 Golden。
- 最终 Chrome 文件任务 31 项、三页／20 指标／净影响 2,462 项、证据专项 34 项、Node 文件契约 45 项通过。完整序列化汇总加入后 Worker 1,523／1,524 通过；独立净影响 722 项、证据 99 项通过，见 [04](04-net-impact.md)、[05](05-evidence.md)。
- 最终完整 pytest 仍为 483 通过、1 失败，唯一失败为排序预期冲突。Ruff、格式检查、Pyright 通过。
- 逐次原始输出在 `output/unified-prototype/resume-*`。大规模、Windows／Edge 尚未执行，不以本机结果代替。
- 源码归档分支 `spike/unified-prototype`，本轮提交标题“原型：接通小规模明细、净影响与完整分页证据”；恢复前基点 `de61d37`。

追加确认：用户回复“yes”，仅交换 `threshold-change / hugeMethod all` 两行使 `above/a.c` 在前，更新审核范围及业务摘要。独立差异核对确认字段值、其余查询及两侧输入不变。完整 pytest 484 项、参考 UI 414 项业务断言、Worker 1,524 项检查全部通过，无 xfail。证据在 `output/unified-prototype/sort-approved-{pytest.txt,worker.json,verification.json}`；历史失败输出不覆盖。满规模、资源门槛及 Windows／Edge 等未验范围保持原登记。
