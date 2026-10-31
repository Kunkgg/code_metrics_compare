# huge-header

**人工确认：已浏览，整体业务场景和口径无异议。** 已纳入正式 golden；不额外推定逐项数值复核范围。依据见 [本轮确认记录](../review-acceptance.md)。

阈值固定为100，严格大于才超限。entered从等于阈值增长1，exited回落到等于阈值；growth/decrease分别在超限范围内增减10，unchanged保持不变。超限总数4不变，新增与退出各1仍须显示。

主查询完整预期（字段顺序见 expected.json）：

| path | b | c | delta |
| --- | --- | --- | --- |
| src/decrease.h | 120 | 110 | -10 |
| src/entered.h | 100 | 101 | 1 |
| src/exited.h | 101 | 100 | -1 |
| src/growth.h | 110 | 120 | 10 |
| src/unchanged.h | 110 | 110 | 0 |

summary_comparison 表示输入汇总的观测差值；不把超限清单进出解释为磁盘文件新增／删除。全部浮点按十进制 Half-Up 四舍五入到两位，不截断。
