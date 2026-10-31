# file-duplication

**人工确认：已浏览，整体业务场景和口径无异议。** 已纳入正式 golden；不额外推定逐项数值复核范围。依据见 [本轮确认记录](../review-acceptance.md)。

整文件重复成员进出：old.c退出、new.c进入、stay.c及mirror.h不变，总成员数3不变。源文件子集为2，源文件重复率分母仍是全部4文件。每侧重复组核心为两份常见的 .c 副本，另附一份同内容 .h 镜像，作为源文件过滤的少见对照；三份均为20个全局int声明，完整内容相同；非成员30行内容不同。按MD5相同这一扫描事实比较成员关系，不在此验证扫描器的哈希实现。原content证据已移至validation/file-content-evidence。

主查询完整预期（字段顺序见 expected.json）：

| path | b | c | delta |
| --- | --- | --- | --- |
| include/mirror.h | 1 | 1 | 0 |
| src/new.c | 0 | 1 | 1 |
| src/old.c | 1 | 0 | -1 |
| src/stay.c | 1 | 1 | 0 |

summary_comparison 表示输入汇总的观测差值；不把超限清单进出解释为磁盘文件新增／删除。全部浮点按十进制 Half-Up 四舍五入到两位，不截断。
