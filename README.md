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

## 离线报告 UI 原型（三方案对比）

> 一次性原型，归档分支 `prototype/prd-ui-comparison`。用于比较信息组织与交互，不是正式报告生成器或性能验收结果。

```bash
# 自动生成可复现模拟数据、执行校验、构建单 HTML，并用默认浏览器打开
uv run python -m cmetrics_cmp_viz.prototype --open
```

产物：[`output/prototype/cmetrics-prototype.html`](output/prototype/cmetrics-prototype.html)。可直接双击，只分发此 HTML 即可；阅读时不依赖 Python、服务、JSON 旁置文件或网络。

| 方案 | 打开方式 | 布局与对比重点 |
|---|---|---|
| A · 指标驾驶舱 | `cmetrics-prototype.html?variant=A` | 指标概览 → 目录 / 文件 → 证据抽屉，适合先发现变化 |
| B · 分析工作台 | `cmetrics-prototype.html?variant=B` | 目录树、明细表、证据三栏并排，适合连续下钻 |
| C · 任务式评审 | `cmetrics-prototype.html?variant=C` | 按 PRD 五项业务任务组织问题、观察和证据 |

也可用底部浮动栏或键盘 `←` / `→` 循环切换；编辑输入框时不拦截方向键。切换方案保留当前分析条件，刷新仅保留 URL 中的方案，其他状态不跨会话保存。页面末尾的“原型状态”可查看全部相关状态。

### 数据与演示入口

- 默认种子 `20261021`，两侧各 **47 个文件、143 个普通函数**；另生成两侧 JSON、内部有效行模型与变化台账，便于核对。
- 两侧正常合成夹具实际执行现有 **L0–L3** 校验。当前 L3 的台账检查是结构检查，不代表所有变化语义或真实输入均已验证。
- 13 项主指标可下钻；“数据质量与说明”包含全部 33 项汇总字段和必要的函数最大值。
- 表格支持目录 / 全报告当前类型范围、标识搜索、变化状态、两侧原值与差值的数值筛选和排序，以及全量查询后的分页。搜索不含源码，也不是跨类型全文搜索。
- 文件可关联函数、重复片段、重复文件、危险函数和冗余块；对象详情提供可复制的定位文本。
- 顶部切换“异常演示 · 受限报告”，查看汇总冲突、重复行未知、阈值变化及目录成员覆盖差异。异常只注入内存副本，不改变已校验的正常 JSON，也不声称异常副本通过 L2。
- 禁用脚本仍有 Python 预生成的正常夹具静态概览；加 `?failInit=1` 可演示初始化失败兜底。兜底明确表示交互不可用。

```bash
# 自定义种子和输出目录
uv run python -m cmetrics_cmp_viz.prototype --seed 42 --output-dir output/prototype-42

# 仅隐藏原型切换栏；仍是原型，不可当作生产构建
uv run python -m cmetrics_cmp_viz.prototype --production-preview --output-dir output/prototype-preview
```

源码位于 `src/cmetrics_cmp_viz/prototype.py`、`prototype_data.py`、`prototype_ui/`。布局取舍见 [原型对比说明](.scratch/report-ui-prototype/spec.md)，业务走查、检查记录及未验证项见 [原型 issue](.scratch/report-ui-prototype/issues/01-ui-comparison.md)。用户选定方案后再提炼正式实现，原型代码不直接产品化。

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
