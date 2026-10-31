# 阈值变化时继续比较详情

**人工确认：已浏览，整体业务场景和口径无异议。** 已纳入正式 golden；不额外推定逐项数值复核范围。依据见 [本轮确认记录](../review-acceptance.md)。 所有文件、普通函数和目录直接成员在两侧相同，只有五类阈值改变。

| 类型 | 基线阈值 | 当前阈值 | 应有进出 |
|---|---:|---:|---|
| hugeHeader | 100 | 99 | equal/a.h 的100行新增超限；above/a.h 的101行仍超限。 |
| hugeSource | 400 | 401 | above/b.c 的401行退出超限。 |
| hugeMethod | 50 | 49 | above/a.c 的equal函数50行新增超限；above/b.c 的above函数51行仍超限。 |
| hugeCC | 10 | 11 | above函数复杂度11退出超限。 |
| folders | 2 | 3 | 根目录与above均有3个直接成员，两者退出超限。 |

每行数值差都是0，但超限状态可能改变：分别按两侧阈值严格 `>` 判定，继续列出 all、entered、exited、changes 等结果。没有清单进出的存续超限对象才属于 unchanged。growth/decrease 在此均为空，因为代码和目录成员没有数值变化。

每类查询都要求 `thresholdChanged=true` 并显示“阈值变化”提示，说明进出可能由阈值改变造成，不证明代码恶化或改善。净影响分解仍受限，不能把显示详情等同于允许所有归因。

根目录在查询中以空字符串表示。目录成员从完整文件集合恢复，申报值与恢复值一致；当前未再超限，原始 huge_folders 可以为空。参考 UI 与 Worker 均已支持根路径，并分别保留扫描申报值和恢复成员数。

原始汇总观测及其两位 Half-Up 差值见 expected.json 的 summary_comparison；普通明细和文件数量没有变化，超限数量及比例随阈值变化。本组已按整体浏览确认纳入 golden；业务预期与输入未因迁移改写。后续用户追加确认仅交换 `hugeMethod all` 两条结果的顺序，使默认 `path:asc` 下 `above/a.c` 在 `above/b.c` 前；数值及其余预期不变，见 [追加确认](../review-acceptance.md#追加确认threshold-change-默认路径排序)。
