# method-lines：函数有效行数业务对比候选

**人工确认：已浏览，整体业务场景和口径无异议。** 已纳入正式 golden；不额外推定逐项数值复核范围。依据见 [本轮确认记录](../review-acceptance.md)。

查询 type 为 `methodLines`；当前度量字段为 `nbnc_loc`。两侧扫描 root 均为 `/golden/project`，默认 `path:asc`，同路径按 `name:asc`。`expected.json` 仅记录业务比较预期；固定行来自下表的独立手算，不在测试时由查询实现生成。

| path | name | b | c | delta | 业务状态 |
|---|---|---:|---:|---:|---|
| src/a.c | cross_enter | 50 | 51 | 1 | growth |
| src/a.c | cross_exit_equal | 60 | 50 | -10 | decrease |
| src/a.c | grow | 20 | 30 | 10 | growth |
| src/a.c | new_only | 0 | 15 | 15 | entered, growth |
| src/a.c | old_only | 12 | 0 | -12 | exited, decrease |
| src/a.c | repeat | 30 | 25 | -5 | decrease |
| src/a.c | shrink | 40 | 25 | -15 | decrease |
| src/a.c | stable_other_changes | 30 | 30 | 0 | unchanged |
| src/b.c | moved | 18 | 18 | 0 | unchanged |

baseline = 50+60+20+12+(10+20)+40+30+18 = 260，共 9 个普通函数；current = 51+50+30+15+25+25+30+18 = 244，共 8 个。均值为 260/9 → 28.89、244/8 → 30.50；差值按序列化值 30.50−28.89 = 1.61。最大值 60 → 51。严格大于 50 的函数各 1 个，比例 1/9×100 → 11.11、1/8×100 → 12.50，差值 1.39。

| summary_comparison 指标 | b | c | delta |
|---|---:|---:|---:|
| methods_total | 9.00 | 8.00 | -1.00 |
| method_lines | 260.00 | 244.00 | -16.00 |
| lines_per_method | 28.89 | 30.50 | 1.61 |
| maximum_nbnc_loc | 60.00 | 51.00 | -9.00 |
| huge_method_total | 1.00 | 1.00 | 0.00 |
| huge_method_ratio | 11.11 | 12.50 | 1.39 |

JSON number 不保存小数尾零；所有浮点数至多两位，均值及率按十进制 Half-Up 到两位。summary_comparison 的 delta 使用已序列化的 b/c 相减再 Half-Up 到两位，不用未舍入均值相减。

all、entered、exited、growth、decrease、unchanged 均列出完整投影；状态可以重叠。

root=/golden/project；按相对 path 与 name 配对，moved 起始行 50→250 仍为同一函数。

stable_other_changes 的圈复杂度 2→30 跨过另一度量阈值，但当前行数不变。

new_only/old_only 在同一个两侧均存在的文件中仅见于一侧，另一侧按本指标总量 0 比较；不推断磁盘新增或删除。

baseline=50，current=50；严格大于才超限，等于 current 阈值时不超限。

最大值记录仅提供派生最大值，不作为普通函数或业务明细行。

普通列表 entered/exited 按函数集合存在性；cross_enter/cross_exit_equal 穿越超限边界仅属于 growth/decrease，不属于普通列表的 entered/exited。

repeat：baseline 2 个（10+20），current 1 个（25），总量 30→25，delta=-5；ambiguous=true、beforeCount=2、afterCount=1、comparisonBasis=same-name-total；保留中文提示，不强行逐对象配对或推断阈值进出。非歧义行的 comparisonBasis/warning 为 null。

两个源文件在两侧都存在。moved 位于 src/b.c，其另一度量也改变，但当前度量与身份不变。输入中的重复、危险调用或冗余条目均为空，本候选只验证对应函数指标的业务对比。

汇总均值、总量、超限数及率取整个扫描的普通函数（包括未进入超大列表的函数），并非仅对筛选后的行求值。maximum_nbnc_loc 如出现于 summary_comparison，表示从函数明细派生的行数最大值，并非第 34 个 summary_metrics 字段。method_metrics 最后一个最大值对象不算函数，不参与 methods_total、均值、同名集合或任何列表行。
