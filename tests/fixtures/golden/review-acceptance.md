# 13 组业务数据的人工确认

用户在本次会话中确认：

> 原 mixed-changes 已拆分、扩充为 13 组按指标组织的业务候选, 我已人工浏览过, 整体上没有问题。

本次批准依据为“已人工浏览，整体业务场景和口径无异议”。本记录不额外推定逐项数值复核的范围；精确输入、预期的自动核对结果与人工确认分别记录。

13 组迁入本目录并标记 `approved`：file-lines、method-lines、method-complexity、code-duplication、file-duplication、unsafe-functions、redundant-code、huge-header、huge-source、huge-method、huge-complexity、huge-folder、threshold-change。此前明确 OK 的 empty、comments-only 保持原批准记录，共 15 组。

迁移只修改位置、审核元信息和说明链接，不修改 baseline/current、业务比较预期或查询行。各组 review 中的摘要固定本次确认所对应的输入及业务预期；它是版本标识，不是人工逐值核对的证明。

批准固定业务预期不代表现有实现通过验收。首次批准时参考 UI 的 414 项业务断言中，400 项通过，14 项存在已知实现差距，涉及函数排序、同名函数集合及计数元信息；该结果为历史记录。原 14 项已在提交 `1056caa` 修复并清除过期 xfail，随后发现的排序预期冲突按下文追加确认处理。完整 Worker、浏览器及性能验收不在首次批准范围内。

原始问题保留在 [审核记录](review-issues.md)，逐项答复和旧 mixed-changes 参考数据可从提交 `0d9e93e` 的 Git 历史查阅。后续修改输入或业务预期需要重新记录变更及确认范围；不能由自动测试通过代替人工批准。

## 追加确认：threshold-change 默认路径排序

用户对以下具体问题回复“yes”：

> 是否只交换这两行预期顺序，使 `above/a.c` 在前，并更新审核摘要？数值及其余业务预期均不变。

确认范围仅为 `threshold-change/expected.json` 中 `hugeMethod all` 的两条结果按默认 `path:asc` 排列：`above/a.c:equal` 在 `above/b.c:above` 前。两行全部字段值、其他查询、汇总预期以及两侧输入均不变。此项追加确认不扩大首次整体浏览确认的逐值复核范围，也不构成完整原型或性能验收。

该组业务摘要由 `57d69b5e2b5e10c6f49f9c5ec28acaf26ef60b8474f40f4809f1f853540b922c` 更新为 `f6fe01dca902227a16632cf06628269b591a0cd15451fbe3a6c47c885b1bedc7`；输入摘要保持不变。
