# huge-method：超大函数有效行数业务对比候选

**人工确认：已浏览，整体业务场景和口径无异议。** 已纳入正式 golden；不额外推定逐项数值复核范围。依据见 [本轮确认记录](../review-acceptance.md)。

查询 type 为 `hugeMethod`；当前度量字段为 `nbnc_loc`。两侧扫描 root 均为 `/golden/project`，默认 `path:asc`，同路径按 `name:asc`。`expected.json` 仅记录业务比较预期；固定行来自下表的独立手算，不在测试时由查询实现生成。

| path | name | b | c | delta | 业务状态 |
|---|---|---:|---:|---:|---|
| src/a.c | below_both | 20 | 25 | 5 | 两侧均未超限，排除于本列表及全部状态过滤 |
| src/a.c | cross_enter | 50 | 61 | 11 | entered, growth |
| src/a.c | cross_exit_equal | 70 | 60 | -10 | exited, decrease |
| src/a.c | grow | 80 | 90 | 10 | growth |
| src/a.c | new_only | 0 | 63 | 63 | entered, growth |
| src/a.c | old_only | 72 | 0 | -72 | exited, decrease |
| src/a.c | shrink | 100 | 75 | -25 | decrease |
| src/a.c | stable_other_changes | 65 | 65 | 0 | unchanged |
| src/a.c | threshold_only_exit | 55 | 55 | 0 | exited（阈值变化造成） |
| src/b.c | moved | 66 | 66 | 0 | unchanged |

baseline = 20+50+70+80+72+100+65+55+66 = 578，current = 25+61+60+90+63+75+65+55+66 = 560，两侧各 9 个普通函数（含 below_both）。均值 578/9 → 64.22、560/9 → 62.22，序列化差值 −2.00；最大值 100 → 90。按各侧阈值严格比较：baseline 有 7 个 >50，current 有 6 个 >60；比例 7/9×100 → 77.78、6/9×100 → 66.67，序列化差值 −11.11。

| summary_comparison 指标 | b | c | delta |
|---|---:|---:|---:|
| methods_total | 9.00 | 9.00 | 0.00 |
| method_lines | 578.00 | 560.00 | -18.00 |
| lines_per_method | 64.22 | 62.22 | -2.00 |
| maximum_nbnc_loc | 100.00 | 90.00 | -10.00 |
| huge_method_total | 7.00 | 6.00 | -1.00 |
| huge_method_ratio | 77.78 | 66.67 | -11.11 |

JSON number 不保存小数尾零；所有浮点数至多两位，均值及率按十进制 Half-Up 到两位。summary_comparison 的 delta 使用已序列化的 b/c 相减再 Half-Up 到两位，不用未舍入均值相减。

all、entered、exited、growth、decrease、unchanged 均列出完整投影；状态可以重叠。

root=/golden/project；按相对 path 与 name 配对，moved 起始行 50→250 仍为同一函数。

stable_other_changes 的圈复杂度 2→30 跨过另一度量阈值，但当前行数不变。

new_only/old_only 在同一个两侧均存在的文件中仅见于一侧，另一侧按本指标总量 0 比较；不推断磁盘新增或删除。

baseline=50，current=60；严格大于才超限，等于 current 阈值时不超限。

最大值记录仅提供派生最大值，不作为普通函数或业务明细行。

仅列任侧至少一个函数超限的对象；below_both 虽增长仍不入超大列表。entered/exited 按各侧阈值，growth/decrease 按已知数值；数值相同且没有超限进出才属于本列表的 unchanged。不因阈值变化停止对比，界面须提示阈值变化。

threshold_only_exit 数值不变但因 current 阈值提高退出，属于 exited 和全部变化；其数值 delta 为 0，但不列入本超大列表的 unchanged。

两个源文件在两侧都存在。moved 位于 src/b.c，其另一度量也改变，但当前度量与身份不变。输入中的重复、危险调用或冗余条目均为空，本候选只验证对应函数指标的业务对比。

汇总均值、总量、超限数及率取整个扫描的普通函数（包括未进入超大列表的函数），并非仅对筛选后的行求值。maximum_nbnc_loc 如出现于 summary_comparison，表示从函数明细派生的行数最大值，并非第 34 个 summary_metrics 字段。method_metrics 最后一个最大值对象不算函数，不参与 methods_total、均值、同名集合或任何列表行。
