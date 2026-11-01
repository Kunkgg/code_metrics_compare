# 05 关联证据的小规模验证

Type: task
Status: resolved

## 问题与结论

问题：完整关联证据保留时，能否在同一三页 UI 下让每个集合分页，并保持两侧独立选组、精确关联跳转及返回？

小规模 Worker 检查通过；整页最终回归见本轮恢复记录。Windows／Edge、满规模证据分布及长时使用仍未验收。

## 实现

- `prototypes/ui/ui_evidence.js` 复用紧凑索引，Worker 内完整过滤后，每集合最多返回 12 项。
- 重复片段组列表、片段、关联文件、整文件重复组及成员、目录直接成员均支持搜索和分页，不以已加载块替代完整范围。
- 两侧组号各自按原始 ID 选择，不推断跨侧组身份；关联文件不要求重复行增长才可达。
- 跳转精确到文件；来源为源指标而目标为头文件时切换到对应完整指标。返回保留两侧选组、各集合查询及页码。
- 目录扫描申报数与恢复成员数分别显示，未申报保持未知，覆盖限制可见；恢复直接成员不包含后代文件。
- 复制保留简短定位，剪贴板不可用时手动兜底显示本次定位。

## 验证

`node scripts/prototype_checks/check-unified-evidence.cjs`：99 项通过。生成独立临时小数据并构建、执行真实内嵌 Worker；覆盖每侧 27 个原 ID 组、32 个成员、31 个关联文件、47 个目录直接成员及所有页、搜索／越界页、两侧独立选组、相似路径精确匹配、未知原值传播、未申报侧与覆盖不足。

检查输入专用于查询压力与边界，含主动注入的覆盖不一致，不作为已批准业务 Golden 或正常生成数据。产物在 `output/unified-prototype/evidence-small/`，本轮输出在 `resume-evidence.json`。浏览器专项已验证两侧独立选组、未增长关联文件、返回恢复和复制手动兜底；最终浏览器公共回归结果在 `resume-browser-*-final.json`。

阶段 4 的断网、失败／注入、跨平台及全部需求矩阵仍需后续统一验收；本记录不将局部证据检查扩大为整个阶段全部通过。

## 归档指针

一次性源码保留于 `spike/unified-prototype`，本轮提交见 [spec](../spec.md)。输入／源码／HTML／uv.lock 摘要及环境见 `output/unified-prototype/resume-environment.json`；大体积产物不提交。


本轮边界收口：见 [07 小规模需求追溯](07-small-boundaries.md)。真实 JSON 的未知值／未知阈值、目录覆盖及版本／映射限制已贯通构建与正常场景三页／静态；零分母、组合歧义、注入、换行字典、确定性乱序响应和全部证据分页／返回完成独立补验。Golden 未改，完整 pytest 484 项通过。旧 workspace 热样本包含重选当前指标的无请求点击，不能用作真实查询性能通过依据；新脚本已修正，历史产物保留。满规模与资源收口转入 [06](06-capacity.md)，Windows／Edge 未测。

## Answer

阶段 4 完成：全部关联证据集合在 Worker 内完整过滤后分页——Node 99 项、Chrome 专项 34 项、浏览器 251 项（76 页、四类重复证据、两侧独立选组、多组交叉、下钻与完整返回）。满规模证据浏览器后续在 [06](06-capacity.md) 记录（full-mixed/full-wide 各 20/20 会话全过，证据 `output/unified-prototype/stage5-handoff-evidence-exec-3/`）。
