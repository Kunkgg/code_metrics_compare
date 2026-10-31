# method-complexity：函数圈复杂度业务对比候选

**人工确认：已浏览，整体业务场景和口径无异议。** 已纳入正式 golden；不额外推定逐项数值复核范围。依据见 [本轮确认记录](../review-acceptance.md)。

查询 type 为 `cc`；当前度量字段为 `cyclomatic_complexity`。两侧扫描 root 均为 `/golden/project`，默认 `path:asc`，同路径按 `name:asc`。`expected.json` 仅记录业务比较预期；固定行来自下表的独立手算，不在测试时由查询实现生成。

| path | name | b | c | delta | 业务状态 |
|---|---|---:|---:|---:|---|
| src/a.c | cross_enter | 10 | 11 | 1 | growth |
| src/a.c | cross_exit_equal | 14 | 10 | -4 | decrease |
| src/a.c | grow | 3 | 5 | 2 | growth |
| src/a.c | new_only | 0 | 2 | 2 | entered, growth |
| src/a.c | old_only | 7 | 0 | -7 | exited, decrease |
| src/a.c | shrink | 8 | 4 | -4 | decrease |
| src/a.c | stable_other_changes | 6 | 6 | 0 | unchanged |
| src/b.c | moved | 4 | 4 | 0 | unchanged |

baseline = 10+14+3+7+8+6+4 = 52，current = 11+10+5+2+4+6+4 = 42，两侧各 7 个普通函数。均值 52/7 → 7.43、42/7 = 6.00，序列化值相减为 −1.43。最大值 14 → 11。严格大于 10 的函数各 1 个，比例 1/7×100 → 14.29，差值 0.00。

| summary_comparison 指标 | b | c | delta |
|---|---:|---:|---:|
| methods_total | 7.00 | 7.00 | 0.00 |
| cyclomatic_complexity_total | 52.00 | 42.00 | -10.00 |
| cyclomatic_complexity_per_method | 7.43 | 6.00 | -1.43 |
| maximum_cyclomatic_complexity | 14.00 | 11.00 | -3.00 |
| huge_cyclomatic_complexity_total | 1.00 | 1.00 | 0.00 |
| huge_cyclomatic_complexity_ratio | 14.29 | 14.29 | 0.00 |

JSON number 不保存小数尾零；所有浮点数至多两位，均值及率按十进制 Half-Up 到两位。summary_comparison 的 delta 使用已序列化的 b/c 相减再 Half-Up 到两位，不用未舍入均值相减。

all、entered、exited、growth、decrease、unchanged 均列出完整投影；状态可以重叠。

root=/golden/project；按相对 path 与 name 配对，moved 起始行 50→250 仍为同一函数。

stable_other_changes 的有效行数 20→80 跨过另一度量阈值，但当前圈复杂度不变。

new_only/old_only 在同一个两侧均存在的文件中仅见于一侧，另一侧按本指标总量 0 比较；不推断磁盘新增或删除。

baseline=10，current=10；严格大于才超限，等于 current 阈值时不超限。

最大值记录仅提供派生最大值，不作为普通函数或业务明细行。

普通列表 entered/exited 按函数集合存在性；cross_enter/cross_exit_equal 穿越超限边界仅属于 growth/decrease，不属于普通列表的 entered/exited。

两个源文件在两侧都存在。moved 位于 src/b.c，其另一度量也改变，但当前度量与身份不变。输入中的重复、危险调用或冗余条目均为空，本候选只验证对应函数指标的业务对比。

汇总均值、总量、超限数及率取整个扫描的普通函数（包括未进入超大列表的函数），并非仅对筛选后的行求值。maximum_nbnc_loc 如出现于 summary_comparison，表示从函数明细派生的行数最大值，并非第 34 个 summary_metrics 字段。method_metrics 最后一个最大值对象不算函数，不参与 methods_total、均值、同名集合或任何列表行。
