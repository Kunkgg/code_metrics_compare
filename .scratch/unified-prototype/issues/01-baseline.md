# 01 固定功能与性能基线

Type: task
Status: resolved

## 目标与范围

业务基线为 `da6642a`。本阶段未修改两套原型业务代码、PRD 或架构文档；建立了独立产物、UI 回归、容量查询已知失败和可复算测量记录。

用户已确认的规模、Windows 和输入范围见 [spec](../spec.md)。阶段 0 完成不表示统一原型或 P1/P3 验收通过。

## 已完成

- `run_baseline.py`：显式指定浏览器可执行文件，每轮独立 profile，CDP offline，真实 file://；保存命令结果、源码／输入／HTML／uv.lock 摘要、完整浏览器版本、页面错误、网络、每次热查询、RSS 时间序列及空会话差分。
- `measure-init.js`：只由检查工具注入，记录 ready 标记、后续两帧、长任务和错误；不改变报告业务函数，不进入产物。
- `check-capacity-contract.cjs`：运行 HTML 内嵌的真实 Worker，通过消息接口与原始输入计算的独立预期比较。默认严格模式返回失败；`--allow-known-failures` 仅容许已登记的具体失败形态，意外通过也要求更新登记。
- 既有 `check-overview-edges.cjs` 新增可选报告路径，原默认入口不变。
- 增加开发依赖 `psutil`，本次锁定 7.2.2，用于跨平台进程树采样；不进入报告运行依赖。
- 三套 100k 报告从既有原始输入重新构建；小型 UI 夹具重新生成并执行两侧 L0–L3，1k 压力数据执行 L1/L2。

## 环境

MacBook Air，Apple M5，10 个逻辑核，16 GiB，macOS 27.0.1；Chrome **156.0.8078.48 headless**，Python 3.12.13、Node 24.21.0、uv 0.13.5。浏览器完整版本由页面 UA-CH 核对。工具默认找到的 Chrome 155 未用于正式基线；已显式传入系统 Chrome 路径。

Windows／Edge 未测试；未指定参考机，当前只登记开发机证据。物理磁盘与最低参考机验收仍待补。

## 正确性结果

- pytest：28 passed；Ruff、格式检查、Pyright、JS 语法、diff 检查通过。
- 小型 UI：两侧 L0–L3 通过；1440px 和 390px 各执行概览 185、异常概览 76、全部指标 296，共 **每尺寸 557 项**断言。
- VM 概览边界：24 项通过。真实浏览器初始化失败仍展示 20 项静态指标，未标交互就绪。
- 正常页面错误为空，网络记录仅有本地 HTML 和 Blob Worker，没有 HTTP(S) 请求。
- 1k Worker 契约：5 项通过、6 项已知失败；严格模式应返回非零，不能称作全部通过。

| 已知失败 | 独立预期 | 实际 |
|---|---|---|
| 1k 第 51 页（每页 1 条） | 对应第 51 个文件 | 空行 |
| 1k 末页 | 对应末个文件 | 空行 |
| 函数名称查询 | 807 个匹配键 | 0 |
| 危险函数名称查询 | 302 个去重位置 | 0 |
| 默认函数变化含歧义 | 9,987 项 | 9,788 项 |
| 重复片段第二页 | page=2，对应第31个片段 | page=1，仍为首个片段 |

三个 100k 数据集还在浏览器正常每页 50 条下复现：第 51 页应显示 50 条，实际为 0；总数分别为 102,000／101,000／102,000。其耗时不计为性能通过。

既有容量自检三组均为 26/26，仍只代表每侧 11 项与 4 项台账，不能代替 33 项完整汇总校验。其他静态发现保留在 spec 缺口表，尚未运行验证的项目不标通过。

## 容量测量

每数据集 3 次干净 profile 启动，首轮查询单独保存；四项热任务各 20 次，nearest-rank P95。文件／函数任务为“全部对象”，不是历史“全部变化”任务，不能直接比较两者的快慢。目录任务在 mixed 选择 `src/bulk`，在 wide 选择实际存在的 `src/wide`，均验证非空候选。

| 场景 | HTML | 构建耗时 | 构建峰值 RSS | ready＋两帧，三次 | 浏览器最大 RSS 增量 |
|---|---:|---:|---:|---|---:|
| 100% mixed | 13.79 MiB | 20.81 s | 2,731.8 MiB | 701.9 / 754.5 / 623.5 ms | 391.48 MiB |
| 1% mixed | 13.78 MiB | 20.61 s | 2,833.3 MiB | 662.1 / 525.5 / 481.0 ms | 393.53 MiB |
| 100% wide | 13.69 MiB | 19.90 s | 2,354.0 MiB | 715.6 / 447.7 / 511.7 ms | 428.44 MiB |

| 热任务 P95 | full | low | wide |
|---|---:|---:|---:|
| 文件全部对象，差值排序，首页 | 192 ms | 212 ms | 243 ms |
| 函数全部对象，差值排序，首页 | 257 ms | 285 ms | 339 ms |
| 文件路径搜索 `unit_000`，首页 | 201 ms | 247 ms | 220 ms |
| 目录范围文件，路径排序，首页 | 246 ms | 197 ms | 220 ms |

证据限制：

- ready＋两帧测量的是页面就绪标记；另执行首次完整文件查询验证交互路径，不能当作所有指标可用。
- 以上是专用容量页面，未接入已选 UI；热样本只检查当前显示数量和重复结果稳定，完整排序仍需阶段 1/2 独立预期验证。
- 100k 输入本阶段仍未执行 L1/L2；构建耗时不包含正式完整校验管线。数据生成时间另计。
- RSS 以独立空会话最后 5 个有效样本中位数为基线；采样目标间隔 100ms，实际最大间隔约 276–382ms。保存全部进程样本，采样无进程读取错误，但有共享页重计、调度延迟和瞬时峰值漏采，不能凭此关闭 2 GiB 验收。
- 未清操作系统磁盘缓存；未覆盖每类冷查询 20 次、长时使用、30% 变化、200k 探索、Windows／Edge／headed。

## 可复现入口

均在仓库根目录执行；输出目录必须为空，避免覆盖旧测量记录。

```bash
uv sync
uv run pytest -q
uv run python -m prototypes.ui.prototype --output-dir output/unified-prototype/stage0/ui
uv run python -m scripts.prototype_scale_data --num-files 1000 --validate L1L2 --output-dir output/unified-prototype/stage0/scale-1k
uv run python -m prototypes.performance.prototype_capacity --input-dir output/unified-prototype/stage0/scale-1k
node scripts/prototype_checks/check-overview-edges.cjs output/unified-prototype/stage0/ui/cmetrics-prototype.html
node scripts/prototype_checks/check-capacity-contract.cjs output/unified-prototype/stage0/scale-1k output/unified-prototype/stage0/scale-1k/capacity-report.html --allow-known-failures
```

去掉 `--allow-known-failures` 会按产品预期执行严格断言并返回失败，用于后续修复后的回归。

100k 三组生成配置及输入摘要保存在证据文件的 `datasets`／`inputs`。按各配置调用 `scripts.prototype_scale_data` 后，使用 `prototype_capacity --input-dir ... --output ...` 构建。首轮复用的原始输入位于 `output/scale-100k-{full,low,wide}/`。

```bash
uv run python -m scripts.prototype_checks.run_baseline \
  --ui-report output/unified-prototype/stage0/ui/cmetrics-prototype.html \
  --capacity-report output/unified-prototype/stage0/scale-100k-full/capacity-report.html \
  --capacity-report output/unified-prototype/stage0/scale-100k-low/capacity-report.html \
  --capacity-report output/unified-prototype/stage0/scale-100k-wide/capacity-report.html \
  --input-dir output/scale-100k-full \
  --input-dir output/scale-100k-low \
  --input-dir output/scale-100k-wide \
  --browser '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --output-dir output/unified-prototype/stage0/chrome-156-final
```

Windows 的浏览器驱动入口同上，换成当地 Chrome／Edge 的可执行路径；可先对复制的自包含报告运行。实际 Windows 运行尚未验证，原压力生成／容量构建器的 Unix `resource` 依赖另列阶段 1 处理。

## 留存材料

- [可版本管理的原始证据](../assets/stage0-chrome156.json)：所有逐次查询、环境、哈希、构建数字、已知失败、进程树 RSS 时间序列。
- `output/unified-prototype/stage0/chrome-156-final/`：详细命令结果、截图、profile、独立 JSON 与采样文件。
- `output/unified-prototype/stage0/scale-100k-{full,low,wide}/build.log`：构建日志；UI／1k 产物保留在同层目录。
- 早期 `runner-smoke`、`chrome-156` 属于工具校准；本记录只采用 `chrome-156-final`，不混用样本。

## Answer

功能与测量基线已固定，阶段 0 完成。进入阶段 1，先用完整查询契约修复分页与排序，再接入已有 UI 的文件／目录完整任务。容量缺陷保留为失败证据，不能以历史速度或当前自检结果掩盖。
