# 13 组业务数据的人工确认

用户在本次会话中确认：

> 原 mixed-changes 已拆分、扩充为 13 组按指标组织的业务候选, 我已人工浏览过, 整体上没有问题。

本次批准依据为“已人工浏览，整体业务场景和口径无异议”。本记录不额外推定逐项数值复核的范围；精确输入、预期的自动核对结果与人工确认分别记录。

13 组迁入本目录并标记 `approved`：file-lines、method-lines、method-complexity、code-duplication、file-duplication、unsafe-functions、redundant-code、huge-header、huge-source、huge-method、huge-complexity、huge-folder、threshold-change。此前明确 OK 的 empty、comments-only 保持原批准记录，共 15 组。

迁移只修改位置、审核元信息和说明链接，不修改 baseline/current、业务比较预期或查询行。各组 review 中的摘要固定本次确认所对应的输入及业务预期；它是版本标识，不是人工逐值核对的证明。

批准固定业务预期不代表现有实现通过验收。当前参考 UI 的 414 项业务断言中，400 项通过，14 项存在已知实现差距，涉及函数排序、同名函数集合及计数元信息。测试按具体断言明确报告这些预期失败，并核对失败形态；其他回归仍应失败。完整 Worker、浏览器及性能验收不在本次批准范围内。

原始问题及逐项答复保留在 [审核记录](../samples/golden-candidates/issues.md) 和 [处理说明](../samples/golden-candidates/review-response.md)。后续修改输入或业务预期需要重新记录变更及确认范围；不能由自动测试通过代替人工批准。
