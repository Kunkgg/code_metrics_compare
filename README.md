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
