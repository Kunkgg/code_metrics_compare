# Cmetrics 度量指标结果对比分析与离线可视化（cmetrics_cmp_viz）

基于 Python 现代 AI-First 技术栈与离线单 HTML 架构的 Cmetrics 度量指标对比分析工具。

## 技术栈与基础设施

- **运行时环境**：Python 3.12+
- **包管理与环境**：`uv` (Astral)
- **代码规范与格式化**：`Ruff` (`uv run ruff check`, `uv run ruff format`)
- **静态类型检查**：`Pyright` (`uv run pyright`)
- **高性能数据引擎**：`msgspec` + `polars`
- **测试框架**：`pytest` + `hypothesis` + `syrupy`
- **Git Hooks**：`pre-commit`

## 常用命令

```bash
# 同步环境与依赖
uv sync

# 代码格式化与自动修复
uv run ruff check --fix
uv run ruff format

# 类型检查
uv run pyright

# 运行测试
uv run pytest
```

## 离线报告 UI 原型（概览 + 三栏分析）

> 一次性原型，归档分支 `prototype/prd-ui-comparison`。用于比较信息组织与交互，不是正式报告生成器或性能验收结果。

```bash
# 自动生成可复现模拟数据、执行校验、构建单 HTML，并用默认浏览器打开
uv run python -m cmetrics_cmp_viz.prototype --open
```

产物：[`output/prototype/cmetrics-prototype.html`](output/prototype/cmetrics-prototype.html)。可直接双击，只分发此 HTML 即可；阅读时不依赖 Python、服务、JSON 旁置文件或网络。

当前按用户反馈合并 A 的概览与 B 的三栏分析，取消 C 和方案切换栏。首轮三方案保留在提交 `7a5edae`。

- **概览**：与分析页共用“常规指标 / 超大指标”两组各 10 项，支持多选“增长 / 新增”“减少 / 退出”“无变化”，默认前两项；卡片、目录图及文件列表同步筛选，超限进出可分别下钻。
- **分析**：顶部按“常规指标 / 超大指标”两行平铺各 10 个指标入口，均值和比例可独立选择；目录、明细、证据三栏联查，重复片段与目录成员使用加宽详情。
- **全部指标**：沿用“常规指标 / 超大指标”两组各 10 项；其余 13 项汇总和最大函数代码行放入默认折叠的“计算过程数据”。五类超大指标的数量与比例各共用一条带单位的超限条件，阈值变化显示基线／当前条件，新增／退出可直接下钻；技术来源默认折叠。

也可直接打开 `?view=overview`、`?view=workspace`、`?view=metrics`。状态仅保存在内存，刷新不保存查询条件。页面末尾折叠的“原型状态”用于核对交互条件。

### 数据与演示入口

- 默认种子 `20261021`，两侧各 **181 个文件、545 个普通函数**；另生成两侧 JSON、内部有效行模型与变化台账。
- 指标中文名统一读取根目录 [`metric_names.md`](metric_names.md)，静态概览与交互页面使用同一映射；不改变原有统计公式。
- 两侧统一称为“基线 / 当前”。小数四舍五入到两位，均值、密度与比例保留尾零，计数保持整数；只调整显示，比较和筛选仍使用原始精度。
- 12 项均值/比例分析合并为“指标变化”：突出整体变化，每个文件或目录只显示一个带正负号的净影响值，按影响大小排序并配正负条形。分子、分母及计算说明默认折叠；支持翻页、精确下钻和返回。解释范围随目录切换，不受表内筛选影响。
- 概览按汇总指标的原始差值区分增长、减少和无变化；超大指标还独立考虑新增与退出，只有汇总未变且无进出才归为无变化。显示舍入为 `0.00` 的微小变化仍按原始方向分类。异常指标保留提示，不参与这三类归类。显示条件在页内切换时保留，刷新恢复默认。
- 五类超大指标均有“新增 1、退出 1、总数不变”的样例。概览同时展示指标净变化与新增／退出计数，点击卡片查看该指标，点击进出计数进入对应超限明细。
- 超大目录阈值为 **50，严格大于才超限**。`src/expanded` 为 50 → 52，`src/trimmed` 为 52 → 50；`src/bulk` 为 52 → 52，但有新增 2、移出 2 个直接成员。
- 重复片段支持两侧独立选组、当前文件高亮、关联文件变化及位置复制。`parser.c` 重复行 40 → 70，关联 `shared.c` 保持 40 → 40；不会按组号匹配前后版本。
- 正常合成夹具继续执行现有 L0–L3 校验，但这些工程层级不出现在报告页面。校验不代替真实数据或容量验收。
- 明细按阅读任务组织：点击目录限定范围，输入路径或名称即时查找，直接选择增长、减少或清单进出；点击表头排序。可选数值条件使用“当前代码行数至少 1000 行”“减少的代码行数至少 100 行”等带单位的表达，应用后持续显示，可单独移除。当前明细数值相同统一标为“无变化”，仅位置、其他度量或关联关系变化不计入“全部变化”。页面保留范围、条件、数量、单位、阈值和异常入口，操作说明段落已精简。筛选排序覆盖全部结果后分页，搜索不含源码，也不是跨类型全文搜索。
- 文件可关联函数、重复片段、重复文件、危险函数和冗余块；文件/目录复制路径，具体位置复制“基线/当前：路径:行号（名称）”，同名无法配对时保留中文提示。
- 顶部切换“异常样例”，查看汇总冲突、重复行未知、阈值变化及目录成员覆盖差异。异常只注入内存副本，不改变已校验的正常 JSON；不可比较的进出不显示为零。
- 禁用脚本仍有 Python 预生成的正常夹具静态概览，按相同两组展示 20 项指标及超限进出；加 `?failInit=1` 可演示初始化失败兜底。兜底明确表示交互不可用。

```bash
# 自定义种子和输出目录
uv run python -m cmetrics_cmp_viz.prototype --seed 42 --output-dir output/prototype-42

# 仅隐藏原型调试状态；仍是原型，不可当作生产构建
uv run python -m cmetrics_cmp_viz.prototype --production-preview --output-dir output/prototype-preview
```

源码位于 `src/cmetrics_cmp_viz/prototype.py`、`prototype_data.py`、`prototype_ui/`。“全部指标分组与阈值展示”见 [第十一轮记录](.scratch/report-ui-prototype/issues/11-all-metrics-groups.md)，“概览分类与显示切换”见 [第十轮记录](.scratch/report-ui-prototype/issues/10-overview-directions.md)，“指标变化”合并与单一影响值见 [第九轮记录](.scratch/report-ui-prototype/issues/09-single-impact.md)，“无变化”口径与文案精简见 [第八轮记录](.scratch/report-ui-prototype/issues/08-metric-only-changes.md)，筛选排序见 [第七轮记录](.scratch/report-ui-prototype/issues/07-task-filters.md)，定位文本见 [第六轮记录](.scratch/report-ui-prototype/issues/06-simple-location.md)，均值/比例与对象贡献见 [第五轮记录](.scratch/report-ui-prototype/issues/05-average-file-explanation.md)，20 项分析入口见 [第四轮记录](.scratch/report-ui-prototype/issues/04-analysis-metric-list.md)，显示规则见 [第三轮记录](.scratch/report-ui-prototype/issues/03-format-and-metric-navigation.md)；布局合并见 [第二轮记录](.scratch/report-ui-prototype/issues/02-combined-data-first.md)，首轮比较见 [历史记录](.scratch/report-ui-prototype/issues/01-ui-comparison.md)。当前仍是一次性原型，不直接产品化。

## 大数据容量验证原型（每侧 10 万文件 / 100 万函数）

> 同样是一次性验证入口，归档分支 `prototype/prd-ui-comparison-large-data`。验证记录：[`.scratch/report-large-data/issues/01-capacity-validation.md`](.scratch/report-large-data/issues/01-capacity-validation.md)。

```bash
# 1. 生成可复现压力数据（两侧扫描 JSON + manifest 台账）
uv run python -m cmetrics_cmp_viz.prototype_scale_data --num-files 100000 --output-dir output/scale-100k-full

# 2. 构建紧凑分块单 HTML（gzip+base64 内嵌，浏览器内 Blob Worker 查询）
uv run python -m cmetrics_cmp_viz.prototype_capacity --input-dir output/scale-100k-full
```

产物：`output/scale-100k-full/capacity-report.html`（约 14.5 MB）。页内可用 `window.scalePrototype.bench('query', {...}, 20)` 复测 P95，`run('verify')` 核对汇总与台账一致性。仅在 Chrome 156 headless + 断网 file:// 实测，未覆盖 Edge/headed/跨 OS。

## 模拟数据生成与校验 (P0)

本项目内置了符合 `schemas/cmetrics-report.schema.json` 契约且支持从明细严格复算汇总的模拟数据生成与分层校验工具。

### 1. 生成模拟扫描数据

```bash
# 生成单份模拟扫描报告
uv run python -m cmetrics_cmp_viz.cli generate --output-dir ./output/single --seed 42 --num-files 20

# 生成 baseline 与 current 对照演化组及变化台账 (change_ledger.json)
uv run python -m cmetrics_cmp_viz.cli generate --pair --output-dir ./output/pair --seed 2026 --num-files 30
```

### 2. 扫描数据分层校验 (L0–L3)

```bash
# 执行 L2 语义校验（默认，包含引用完整性与 33 项指标公式复算）
uv run python -m cmetrics_cmp_viz.cli validate ./output/single/mock_scan.json --level L2

# 结合内部模型执行 L3 校验（验证重复行有效覆盖并集一致性）
uv run python -m cmetrics_cmp_viz.cli validate ./output/single/mock_scan.json \
  --level L3 \
  --internal-model ./output/single/internal_model.json
```
