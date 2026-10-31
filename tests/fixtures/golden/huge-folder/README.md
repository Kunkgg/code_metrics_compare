# huge-folder

**人工确认：已浏览，整体业务场景和口径无异议。** 已纳入正式 golden；不额外推定逐项数值复核范围。依据见 [本轮确认记录](../review-acceptance.md)。

目录阈值2，直接成员2→3新增超限、3→2退出、3→4增长、4→3减少、3→3不变。根目录直接包含5个子目录，也超限且不变。unchanged目录成员unit_0移出、unit_3进入，数量仍为3。这里的申报数量与恢复成员始终一致，替代原有folder-coverage负例作为业务候选。

主查询完整预期（字段顺序见 expected.json）：

| path | b | c | delta |
| --- | --- | --- | --- |
|  | 5 | 5 | 0 |
| decrease | 4 | 3 | -1 |
| entered | 2 | 3 | 1 |
| exited | 3 | 2 | -1 |
| growth | 3 | 4 | 1 |
| unchanged | 3 | 3 | 0 |

summary_comparison 表示输入汇总的观测差值；不把超限清单进出解释为磁盘文件新增／删除。全部浮点按十进制 Half-Up 四舍五入到两位，不截断。
