# 08 满规模断网、失败与注入专项

Type: task
Status: resolved

## 范围

在满规模（每侧 100k 文件／100 万普通函数）输入与报告 HTML 上，复验 [07](07-small-boundaries.md) 已在小规模通过的故障面：断网加载、Worker 初始化／运行失败重试与静态兜底、确定性乱序响应、路径／名称／指标名称注入。现有 resilience 检查需按满规模 HTML／输入适配后执行，证据写独立输出目录，不覆盖既有产物。

## 背景

spec 阶段 5 完成条件含“断网／失败／注入”；小规模结论见 07。[06](06-capacity.md) 的容量矩阵（短测／oracle／长时／证据／净影响／管线）不覆盖该专项。200k／2m 属探索上限，不在本 issue 范围。

## 完成条件

满规模下各故障场景行为与小规模结论一致：失败可重试、旧响应不晚于新响应呈现、注入不产生恶意 DOM 节点、静态兜底可用且明示交互不可用；失败样本原样保留，不以通过名义掩盖。

## Answer

已执行并通过（2026 本机 macOS，Chrome Headless 156，全程断网）。输入 `stage5-inputs/full-mixed`（每侧 100k 文件／100 万函数，两侧各约 366MB）；主报告复用 stage5 已验证 artifact（sha256 `05b33378…` 运行时校验一致）。全部产物在全新目录 `output/unified-prototype/stage5-resilience-full-v1/`（协议 `unified-resilience-full-1`，说明见其 `NOTES.md`）。

行为与小规模一致：

- resilience 22 项全过：失败保留上次成功结果、错误转义、重试使用最新查询、旧成功／旧失败晚到均不覆盖新状态、查询注入不执行且原值保留。唯一／零命中查询词（`unit_000007_…navigation.c`＝唯一文件、`parser.c`＝零命中）经 16MiB 流式扫描预先核实。
- Worker 初始化失败：静态兜底 20 行、interactive-ready=false、重试可用；重试后恢复。Worker 运行失败：错误明示“下方为上次成功结果”、上次结果仍可见；重试后恢复。
- 指标名称注入与路径／函数名注入（经真实二进制打包与 DOM 查询链路）：未执行、零恶意 DOM 节点、原值可读（静态／交互／复制串均保留注入串）。注入变换与 07 全树 mutate 等价性由边界安全精确计数复核（name 79,831／side、path 14／side，替换后原 token 零残留）。
- failInit=1 与去脚本静态页：兜底 20 行可见、明示交互不可用；断网全程无 http(s) 请求。

失败样本如实登记（`run1-failed-driver-bug.log`）：首跑败于驱动自身 manifest 路径 bug（非页面失败），修复后全过；该失败同时验证了非通道签名不触发重试。另登记本人一次流程失误：重跑复用输出目录覆盖了 run 1 的 browser 中间证据（关键值已在会话留痕，原始命令文件未存）。

工具与校准：新驱动 `run_unified_resilience_full.py` 复用 capacity 的 DevTools 通道断连签名做会话级丢弃重试；红环校准（多命中词打爆 `result===1` 断言）与假通道重试校准（3 次丢弃、上限 exit 1）均通过，见 `stage5-resilience-full-calibration/`。

边界：仅 full-mixed 一组；200k／2m 探索与 full-wide/full-deep 同专项未执行（不在本 issue 范围）；Windows Chrome／Edge 与 macOS Edge 已退出验收范围。本机已验证范围，不宣称完整验收通过。
