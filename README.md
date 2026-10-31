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

## 目录约定

- `docs/`：需求、可行性、架构、指标名称和技术研究；`docs/agents/` 保留 Agent 工作约定。
- `prototypes/ui/`、`prototypes/performance/`：已确认 UI 原型与独立容量验证原型。
- `scripts/`：独立压力数据生成器及 `prototype_checks/` 原型检查脚本。
- `src/cmetrics_cmp_viz/`：现有 CLI、模拟生成器、数据类型与校验器，后续正式代码在 `src/` 开发。
- `tests/`、`schemas/`：自动化测试与模拟扫描结构契约。
- `.scratch/`：历史交接、spec、issue 及需要版本管理的实验材料。
- `output/`：生成数据、报告、截图和临时验证产物，继续由 Git 忽略。
- 根目录 `AGENTS.md`、`GLOSSARY.md`：项目级 Agent 规范与领域术语。

Golden Dataset 只验证对比业务逻辑，包含基线输入、当前输入和人工确认的预期输出。13 组业务候选已获用户确认“已人工浏览、整体场景和口径无异议”，与原已明确 OK 的 `empty`、`comments-only` 合计 15 组，纳入 [`tests/fixtures/golden/`](tests/fixtures/golden/README.md)，metadata 标记为 `approved`，业务内容不变。批准范围仅为上述整体浏览确认，不据此认定逐值复核完成，也不等于实现验收。原始审核意见保留在 [issues.md](tests/fixtures/samples/golden-candidates/issues.md)。由 `uv run pytest tests/test_golden.py -q` 执行业务查询。当前参考 UI 的 414 项业务断言中，400 项通过，14 项为函数排序、同名聚合计数的真实实现差距；后续按具体断言设置 `strict xfail` 并锁定失败形态，不将其记为数据审核未通过。统一原型继续暂停，本轮不修实现、不启动大规模测试；后续计划另行调整，本轮不重写已有阶段计划。Schema、公式、内容证据与校验器负例移入 [`tests/fixtures/validation/`](tests/fixtures/validation/README.md)，由独立测试执行。其他小规模参考材料纳入 `tests/fixtures/samples/`。早期 `init_requirements.md`、`sample.json` 已从工作树移除，历史版本可用 `git show d1ebe80:文件名` 查阅。

下列命令均在仓库根目录执行。

## 离线报告 UI 原型（概览 + 三栏分析）

> 一次性原型，归档分支 `prototype/prd-ui-comparison`。用于比较信息组织与交互，不是正式报告生成器或性能验收结果。

```bash
# 自动生成可复现模拟数据、执行校验、构建单 HTML，并用默认浏览器打开
uv run python -m prototypes.ui.prototype --open
```

产物：[`output/prototype/cmetrics-prototype.html`](output/prototype/cmetrics-prototype.html)。可直接双击，只分发此 HTML 即可；阅读时不依赖 Python、服务、JSON 旁置文件或网络。

当前按用户反馈合并 A 的概览与 B 的三栏分析，取消 C 和方案切换栏。首轮三方案保留在提交 `7a5edae`。

- **概览**：与分析页共用“常规指标 / 超大指标”两组各 10 项，支持多选“增长 / 新增”“减少 / 退出”“无变化”，默认前两项；卡片、目录图及文件列表同步筛选，超限进出可分别下钻。
- **分析**：顶部按“常规指标 / 超大指标”两行平铺各 10 个指标入口，均值和比例可独立选择；目录、明细、证据三栏联查，重复片段与目录成员使用加宽详情。
- **全部指标**：沿用“常规指标 / 超大指标”两组各 10 项；其余 13 项汇总和最大函数代码行放入默认折叠的“计算过程数据”。五类超大指标的数量与比例各共用一条带单位的超限条件，阈值变化显示基线／当前条件，新增／退出可直接下钻；技术来源默认折叠。

也可直接打开 `?view=overview`、`?view=workspace`、`?view=metrics`。状态仅保存在内存，刷新不保存查询条件。页面末尾折叠的“原型状态”用于核对交互条件。

### 数据与演示入口

- 默认种子 `20261021`，两侧各 **181 个文件、545 个普通函数**；另生成两侧 JSON、内部有效行模型与变化台账。
- 指标中文名统一读取 [`docs/metric_names.md`](docs/metric_names.md)，静态概览与交互页面使用同一映射；不改变原有统计公式。
- 两侧统一称为“基线 / 当前”。所有对外业务浮点数均采用十进制 Half-Up 四舍五入至两位，不截断；均值、密度与比例显示保留尾零，计数保持整数。内部比较和筛选继续使用原始计数及未舍入分子／分母。
- 12 项均值/比例分析合并为“指标变化”：突出整体变化，每个文件或目录只显示一个带正负号的净影响值，按影响大小排序并配正负条形。分子、分母及计算说明默认折叠；支持翻页、精确下钻和返回。解释范围随目录切换，不受表内筛选影响。
- 概览按汇总指标的原始差值区分增长、减少和无变化；超大指标还独立考虑新增与退出，只有汇总未变且无进出才归为无变化。显示舍入为 `0.00` 的微小变化仍按原始方向分类。异常指标保留提示，不参与这三类归类。显示条件在页内切换时保留，刷新恢复默认。
- 五类超大指标均有“新增 1、退出 1、总数不变”的样例。概览同时展示指标净变化与新增／退出计数，点击卡片查看该指标，点击进出计数进入对应超限明细。
- 超大目录阈值为 **50，严格大于才超限**。`src/expanded` 为 50 → 52，`src/trimmed` 为 52 → 50；`src/bulk` 为 52 → 52，但有新增 2、移出 2 个直接成员。
- 重复片段支持两侧独立选组、当前文件高亮、关联文件变化及位置复制。`parser.c` 重复行 40 → 70，关联 `shared.c` 保持 40 → 40；不会按组号匹配前后版本。
- 正常合成夹具继续执行现有 L0–L3 校验，但这些工程层级不出现在报告页面。校验不代替真实数据或容量验收。
- 明细按阅读任务组织：点击目录限定范围，输入路径或名称即时查找，直接选择增长、减少或清单进出；点击表头排序。可选数值条件使用“当前代码行数至少 1000 行”“减少的代码行数至少 100 行”等带单位的表达，应用后持续显示，可单独移除。当前明细数值相同统一标为“无变化”，仅位置、其他度量或关联关系变化不计入“全部变化”。页面保留范围、条件、数量、单位、阈值和异常入口，操作说明段落已精简。筛选排序覆盖全部结果后分页，搜索不含源码，也不是跨类型全文搜索。
- 文件可关联函数、重复片段、重复文件、危险函数和冗余块；文件/目录复制路径，具体位置复制“基线/当前：路径:行号（名称）”，同名无法配对时保留中文提示。
- 顶部切换“异常样例”，查看汇总冲突、重复行未知、阈值变化及目录成员覆盖差异。异常只注入内存副本，不改变已校验的正常 JSON；用户确认真实工具不输出的冲突／缺值样例不作为业务 golden。阈值变化继续按各侧阈值比较超大详情及进出，并明确提示；未知或覆盖不足等不可确定的进出不显示为零。
- 禁用脚本仍有 Python 预生成的正常夹具静态概览，按相同两组展示 20 项指标及超限进出；加 `?failInit=1` 可演示初始化失败兜底。兜底明确表示交互不可用。

```bash
# 自定义种子和输出目录
uv run python -m prototypes.ui.prototype --seed 42 --output-dir output/prototype-42
```

源码位于 `prototypes/ui/`，包含 `prototype.py`、`prototype_data.py` 与 HTML/CSS/JS。“全部指标分组与阈值展示”见 [第十一轮记录](.scratch/report-ui-prototype/issues/11-all-metrics-groups.md)，“概览分类与显示切换”见 [第十轮记录](.scratch/report-ui-prototype/issues/10-overview-directions.md)，“指标变化”合并与单一影响值见 [第九轮记录](.scratch/report-ui-prototype/issues/09-single-impact.md)，“无变化”口径与文案精简见 [第八轮记录](.scratch/report-ui-prototype/issues/08-metric-only-changes.md)，筛选排序见 [第七轮记录](.scratch/report-ui-prototype/issues/07-task-filters.md)，定位文本见 [第六轮记录](.scratch/report-ui-prototype/issues/06-simple-location.md)，均值/比例与对象贡献见 [第五轮记录](.scratch/report-ui-prototype/issues/05-average-file-explanation.md)，20 项分析入口见 [第四轮记录](.scratch/report-ui-prototype/issues/04-analysis-metric-list.md)，显示规则见 [第三轮记录](.scratch/report-ui-prototype/issues/03-format-and-metric-navigation.md)；布局合并见 [第二轮记录](.scratch/report-ui-prototype/issues/02-combined-data-first.md)，首轮比较见 [历史记录](.scratch/report-ui-prototype/issues/01-ui-comparison.md)。当前仍是一次性原型，不直接产品化。

## 大数据容量验证原型（每侧 10 万文件 / 100 万函数）

> 同样是一次性验证入口，归档分支 `prototype/prd-ui-comparison-large-data`。验证记录：[`.scratch/report-large-data/issues/01-capacity-validation.md`](.scratch/report-large-data/issues/01-capacity-validation.md)。

```bash
# 1. 生成可复现压力数据（两侧扫描 JSON + manifest 台账）
uv run python -m scripts.prototype_scale_data --num-files 100000 --output-dir output/scale-100k-full

# 2. 构建紧凑分块单 HTML（gzip+base64 内嵌，浏览器内 Blob Worker 查询）
uv run python -m prototypes.performance.prototype_capacity --input-dir output/scale-100k-full
```

产物：`output/scale-100k-full/capacity-report.html`（约 14.5 MB）。页内可用 `window.scalePrototype.bench('query', {...}, 20)` 复测 P95，`run('verify')` 核对汇总与台账一致性。仅在 Chrome 156 headless + 断网 file:// 实测，未覆盖 Edge/headed/跨 OS。

## 原型检查与输出保留

`output/prototype/` 保留当前 UI 报告、合成数据及历轮截图；`output/scale-100k-{full,low,wide}/` 保留三种容量场景，`output/scale-1k/`、`output/scale-10k/` 保留小规模校验和报告。过时预览、临时 `scale-check-*` 数据及重复生成日志已清理，两份独立校验 manifest 保存在 [容量验证材料](.scratch/report-large-data/assets/) 中；它们是实验记录，不是人工预期输出。

原先位于忽略目录中的四个检查脚本已纳入 `scripts/prototype_checks/`：

- `check-overview.js`、`check-overview-anomalies.js`：分别在正常概览页执行的页面内断言。
- `check-all-metrics.js`：在正常全部指标页（`?view=metrics`）执行的页面内断言。
- `check-overview-edges.cjs`：读取默认 UI 产物及源码，在 Node.js 中检查边界行为：`node scripts/prototype_checks/check-overview-edges.cjs`。

前三个脚本通过浏览器控制台或自动化工具执行完整文件内容，需要默认原型状态；它们不属于 pytest 测试集。迁移前后构建和浏览器验证产物放在 `output/reorg-verification/`。

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
