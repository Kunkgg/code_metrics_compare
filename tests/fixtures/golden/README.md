# 已人工确认的业务对比数据

本目录保存 15 组固定业务输入与预期，只验证对比业务逻辑；Schema、公式和输入构造证据另放 [validation](../validation/README.md)。

`empty`、`comments-only` 依据用户原 [审核记录](review-issues.md) 的 OK 结论。其余 13 组依据用户“已人工浏览过，整体上没有问题”的确认纳入；批准范围及原话见 [本轮确认记录](review-acceptance.md)。不额外推定逐项数值复核范围，人工确认与自动检查分别记载。

| 数据组 | 业务重点 |
|---|---|
| [empty](empty/expected.json) | 空扫描结果与零总量。 |
| [comments-only](comments-only/expected.json) | 文件存在但有效代码行为零。 |
| [file-lines](file-lines/README.md) | 扫描集合进出、代码行五类变化，整体净零仍保留内部变化。 |
| [method-lines](method-lines/README.md) | 函数代码行、位置移动、同名集合变化与混淆提示。 |
| [method-complexity](method-complexity/README.md) | 函数复杂度五类变化，总量、均值和最大值。 |
| [code-duplication](code-duplication/README.md) | 重复行变化、头文件过滤与源代码重复率分母。 |
| [file-duplication](file-duplication/README.md) | 重复文件成员进入／退出／保留，组号改名不改变成员事实。 |
| [unsafe-functions](unsafe-functions/README.md) | 调用记录新增／消失／保留，同一行不同名称分开。 |
| [redundant-code](redundant-code/README.md) | 冗余条目进出与重复起始行的条目重数。 |
| [huge-header](huge-header/README.md) | 超大头文件进出及增长／减少／不变。 |
| [huge-source](huge-source/README.md) | 超大源文件对应变化，等于阈值时退出。 |
| [huge-method](huge-method/README.md) | 超大函数对应变化，阈值改变仍比较。 |
| [huge-complexity](huge-complexity/README.md) | 超大复杂度对应变化及纯阈值退出。 |
| [huge-folder](huge-folder/README.md) | 直接成员五类变化、根目录及数量不变时的成员替换。 |
| [threshold-change](threshold-change/README.md) | 五类阈值改变，代码不变也展示超限进出与警示。 |

每组保留 baseline/current、固定业务 expected 和原型 manifest。所有业务浮点输出按十进制 Half-Up 四舍五入至两位，不截断；内部计算、分类和排序继续保留未舍入分子／分母。业务预期不由被测实现运行时生成。

运行 `uv run pytest tests/test_golden.py -q`，通过 Node.js 执行参考 UI 的真实业务查询。414 项业务断言中，413 项通过；原登记的 14 条实现差距已修复，`business_known_gaps.json` 的失败清单已清空。剩余 `threshold-change / hugeMethod all` 的已批准预期仍按名称排列两条跨文件函数，与 `path:asc` 路径优先规范冲突。保留真实失败，等待人工确认后修订预期和审核摘要，不通过特殊化排序或增加 xfail 消除冲突。对应 [阶段 2 工作项](../../../.scratch/unified-prototype/issues/03-detail-queries.md)。数据批准不等于实现验收。

仅逐项业务断言使用预期失败；审核元信息、批准输入摘要和业务预期摘要仍独立验证。该入口不执行浏览器渲染或性能验收。紧凑 Worker 由 `scripts/prototype_checks/check-worker-business.cjs` 逐页核验，目录扫描申报值与恢复成员数分别保留；净影响和关联证据由独立原型检查覆盖。

新建或修改业务输入／预期时，须按实际变更记录人工确认范围，再纳入正式 golden；自动测试不能代为批准。统一原型已恢复小规模功能验证；大型性能验收在全部功能之后执行。
