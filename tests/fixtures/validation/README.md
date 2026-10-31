# 输入、公式与内容证据夹具

这些材料从原 golden 候选移出，只服务于校验器和模拟输入契约测试。用户已明确 golden data 应验证对比业务逻辑，因此它们不作为业务 golden，也不要求用户逐组批准后才能运行校验器测试。

| 夹具 | 原目的与处置 |
|---|---|
| folder-coverage | 故意申报 src 直接成员 5，但 file_sizes 只能恢复 3；验证 L1 接受、L2 拒绝。这个不一致是负例，不能作为正常对比输入。有效业务版本见候选 huge-folder。 |
| missing-value | 人为将重复行设为 null，验证模拟 Schema 拒绝；用户确认真实工具不产生此情况，已从业务候选移除。 |
| summary-conflict | 人为把汇总代码行多写 1，验证 L2 冲突检查；用户确认真实工具不产生此情况，已从业务候选移除。 |
| strict-thresholds | 检查各类阈值的 -1、等于、+1，严格大于才超限。原两侧完全相同，主要验证派生规则；业务进出已拆入各 huge-* 候选。 |
| density-999-1000 | 检查仅 redundant_code_kloc 在代码行 <1000 时强制为0，恰好1000恢复除法；unsafe_functions_kloc 没有此特例。 |
| density-1000-1001 | 检查正常密度除法及两位四舍五入；1001行、2冗余块得到2000/1001≈1.998002，输出2.00，不是截断的1.99。 |
| file-content-evidence | 原 file-duplication/content 的实际小文件与对应输入；同侧两份 .c 字节相同、MD5相同，并核对物理行与有效行。证明构造证据，不执行对比逻辑。 |

`uv run pytest tests/test_validation_fixtures.py -q` 只执行这些工程约束。expected.json 的汇总、最大值及 validation 字段属于校验器预期；业务查询及过期候选审核状态已经移除。两位精度已按本轮规则同步。
