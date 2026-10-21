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
