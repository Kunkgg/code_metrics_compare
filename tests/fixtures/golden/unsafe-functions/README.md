# unsafe-functions

**人工确认：已浏览，整体业务场景和口径无异议。** 已纳入正式 golden；不额外推定逐项数值复核范围。依据见 [本轮确认记录](../review-acceptance.md)。

危险函数记录按文件／名称／行号比较：strcpy:10消失，strcpy:40与system:30新增；gets:30、strcpy:20不变。gets与system同一行不合并；新增／消失不证明问题修复。记录本身是0/1关系，数量3→4。

主查询完整预期（字段顺序见 expected.json）：

| path | name | line | b | c | delta |
| --- | --- | --- | --- | --- | --- |
| src/a.c | gets | 30 | 1 | 1 | 0 |
| src/a.c | strcpy | 10 | 1 | 0 | -1 |
| src/a.c | strcpy | 20 | 1 | 1 | 0 |
| src/a.c | strcpy | 40 | 0 | 1 | 1 |
| src/a.c | system | 30 | 0 | 1 | 1 |

summary_comparison 表示输入汇总的观测差值；不把超限清单进出解释为磁盘文件新增／删除。全部浮点按十进制 Half-Up 四舍五入到两位，不截断。
