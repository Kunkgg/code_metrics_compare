# 候选入口与原审核记录

上一批按指标拆分的 13 组数据已获用户“已人工浏览过，整体上没有问题”的确认，已迁入 [正式 golden 索引](../../golden/README.md)。此前 empty、comments-only 已明确 OK，现共 15 组。审核范围见 [确认记录](../../golden/review-acceptance.md)；不额外推定逐项数值复核范围。

本目录当前没有未批准的数据组，保留 [原始问题](issues.md) 和 [逐项答复](review-response.md) 供追溯。将来的新增或修改继续先放这里，记录输入、固定业务预期、说明和确认范围；自动检查通过不等于人工批准。

批准与实现验收独立：当前 414 项参考 UI 业务断言有 400 项通过、14 项已知实现差距，逐项报告并锁定失败形态，没有把预期改成现有错误行为。统一原型主任务仍暂停。Schema、公式、哈希证据及校验负例放 [validation](../../validation/README.md)；原 mixed-changes 放 [comparison-reference](../comparison-reference/README.md) 保留历史材料。
