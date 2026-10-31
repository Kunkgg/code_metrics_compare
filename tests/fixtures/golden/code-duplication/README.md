# code-duplication

**人工确认：已浏览，整体业务场景和口径无异议。** 已纳入正式 golden；不额外推定逐项数值复核范围。依据见 [本轮确认记录](../review-acceptance.md)。

重复代码行与源代码重复率分开：头文件重复行10→20推高整体重复率，源文件重复行合计70不变。源代码重复率分母仍为全部600行。所有文件都存在，重复行0↔20只表示该度量增长／减少。

主查询完整预期（字段顺序见 expected.json）：

| path | b | c | delta |
| --- | --- | --- | --- |
| include/api.h | 10 | 20 | 10 |
| src/decrease.c | 30 | 10 | -20 |
| src/entered.c | 0 | 20 | 20 |
| src/exited.c | 20 | 0 | -20 |
| src/growth.c | 10 | 30 | 20 |
| src/unchanged.c | 10 | 10 | 0 |

summary_comparison 表示输入汇总的观测差值；不把超限清单进出解释为磁盘文件新增／删除。全部浮点按十进制 Half-Up 四舍五入到两位，不截断。
