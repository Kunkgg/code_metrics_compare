# 04 十二项净影响的小规模验证

Type: task
Status: claimed

## 问题与结论

问题：同一三页 UI 下，能否让全部 12 项均值／比例在完整范围内计算净影响，并有界分页、精确下钻与返回？

实现已接入，小规模计算检查通过；Golden 排序预期冲突已获用户追加确认并消除，最终阶段验收仍受满规模与跨平台矩阵限制，不据此宣布整个原型完成。

## 实现

- `prototypes/ui/ui_impact.js` 在 Worker 内读取完整紧凑列，函数按文件归集，超限逐条原始记录严格 `>` 判定。
- 解释范围只随目录和全报告范围变化，表内查询、状态、数值条件、明细页和精确文件条件不改变解释范围。
- 固定先分子后分母，计算和排名保留未舍入值；公共分母计算净影响，避免两项相加扰乱并列次序。保留分子／分母非零而净值为零的抵消项。
- 完整排名在 Worker 缓存，每次只返回 5 项；跨页共享完整范围最大标尺。
- 零分母、未知、真实汇总冲突、目录覆盖不足和阈值变化分别抑制分解及排名。序列化两位舍入值与精确比例不相等不会误报冲突；仅阈值变化时保留可靠观测差值。
- 贡献文件可在当前明细页外精确下钻；返回恢复原指标、查询、明细页及贡献页。

## 验证

`node scripts/prototype_checks/check-unified-impact.cjs`：722 项通过。预期来自独立原始整数及 BigInt 有理数计算，覆盖 12 项、全报告／目录／子目录／不存在范围、263 对象／53 页、完整顺序、总量守恒、抵消项、跨页标尺及各类受限情况。该入口执行实际计算源码及 snapshot，独立构造解码后的状态；真实内嵌 HTML 另外由 Golden Worker 与浏览器验证。

`node scripts/prototype_checks/check-worker-business.cjs output/unified-prototype/resume-small tests/fixtures/golden/*/`：用户追加确认两行路径排序后，1,524 项全部通过；其中原业务断言为 414 项，其余为两侧全量序列化汇总、阈值及最大值字段核对。确认范围见 [03](03-detail-queries.md)，输入及业务数值不变。

浏览器最终结果与逐次时间样本见 `output/unified-prototype/resume-browser-final.json`，文件任务结果见 `resume-browser-files-final.json`。首次切换和 20 次热操作分开保存；DOM 完成后再等待两帧。OS 磁盘缓存未控制，浏览器进程树 RSS 未采集，不宣称资源门槛或满规模通过。

## 归档指针

一次性原型源码保留于 `spike/unified-prototype`，本轮提交见 [spec](../spec.md) 的恢复记录。输入／源码／HTML／uv.lock 摘要及环境见 `output/unified-prototype/resume-environment.json`。所有大体积产物保持在忽略目录中；主分支未引入原型或正式产品目录。


本轮边界收口：见 [07 小规模需求追溯](07-small-boundaries.md)。真实 JSON 的未知值／未知阈值、目录覆盖及版本／映射限制已贯通构建与正常场景三页／静态；零分母、组合歧义、注入、换行字典、确定性乱序响应和全部证据分页／返回完成独立补验。Golden 未改，完整 pytest 484 项通过。旧 workspace 热样本包含重选当前指标的无请求点击，不能用作真实查询性能通过依据；新脚本已修正，历史产物保留。满规模与资源收口转入 [06](06-capacity.md)，Windows／Edge 未测。
