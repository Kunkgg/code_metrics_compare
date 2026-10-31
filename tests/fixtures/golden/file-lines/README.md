# file-lines

**人工确认：已浏览，整体业务场景和口径无异议。** 已纳入正式 golden；不额外推定逐项数值复核范围。依据见 [本轮确认记录](../review-acceptance.md)。

文件代码行五类变化；减少10与增长10、新增15与移出15分别抵消。整体55行和每文件13.75行均不变，仍须保留各对象变化。

主查询完整预期（字段顺序见 expected.json）：

| path | b | c | delta |
| --- | --- | --- | --- |
| src/decrease.c | 20 | 10 | -10 |
| src/entered.c | 0 | 15 | 15 |
| src/exited.c | 15 | 0 | -15 |
| src/growth.c | 10 | 20 | 10 |
| src/unchanged.c | 10 | 10 | 0 |

summary_comparison 表示输入汇总的观测差值；不把超限清单进出解释为磁盘文件新增／删除。全部浮点按十进制 Half-Up 四舍五入到两位，不截断。
