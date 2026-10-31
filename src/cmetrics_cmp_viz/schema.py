"""Cmetrics 扫描结果数据契约与数值计算工具.

完全对齐 schemas/cmetrics-report.schema.json 与 docs/mock-data-generation.md.
"""

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import msgspec


def round_half_up(val: float | Decimal | int, decimals: int = 2) -> float:
    """按十进制 Half-Up 规则默认舍入到两位小数；底层计算可显式指定精度。"""
    d = Decimal(str(val)) if not isinstance(val, Decimal) else val
    factor = Decimal(10) ** -decimals
    rounded = d.quantize(factor, rounding=ROUND_HALF_UP)
    # 去除多余的尾随零，转为标准浮点输出（如果为整数则转为 int/float）
    f = float(rounded)
    return f if not f.is_integer() else round(f, decimals)


def safe_div(num: int | float, denom: int | float, multiplier: float = 1.0) -> float:
    """安全除法：分母为 0 时返回 0.0，否则按 Decimal Half-Up 统一舍入到两位小数。"""
    if denom == 0:
        return 0.0
    val = (Decimal(str(num)) / Decimal(str(denom))) * Decimal(str(multiplier))
    return round_half_up(val)


class HugeThreshold(msgspec.Struct, forbid_unknown_fields=True):
    """超限阈值对象."""

    huge_headerfile: int
    huge_non_headerfile: int
    huge_method: int
    huge_cyclomatic_complexity: int
    huge_folder: int


class SummaryMetrics(msgspec.Struct, forbid_unknown_fields=True):
    """汇总度量指标（33 项必填数值 + 3 项必填元信息 + 2 项可选兼容器字段）."""

    code_size: int
    raw_lines: int
    methods_total: int
    cyclomatic_complexity_total: int
    cyclomatic_complexity_per_method: float
    maximum_cyclomatic_complexity: int
    huge_cyclomatic_complexity_total: int
    huge_cyclomatic_complexity_ratio: float
    method_lines: int
    lines_per_method: float
    huge_method_total: int
    huge_method_ratio: float
    files_total: int
    folders_total: int
    lines_per_file: float
    huge_headerfile_total: int
    huge_headerfile_ratio: float
    huge_non_headerfile_total: int
    huge_non_headerfile_ratio: float
    huge_folder_total: int
    huge_folder_ratio: float
    file_duplication_total: int
    file_duplication_ratio: float
    non_hfile_duplication_total: int
    non_hfile_duplication_ratio: float
    code_duplication_total: int
    code_duplication_ratio: float
    non_hfile_code_duplication_total: int
    non_hfile_code_duplication_ratio: float
    unsafe_functions_total: int
    unsafe_functions_kloc: float
    redundant_code_total: int
    redundant_code_kloc: float
    cmetrics_version: str
    huge_threshold: HugeThreshold
    command: str
    warning_suppression_total: int | None = None
    warning_suppression_kloc: float | None = None


class MethodItem(msgspec.Struct, forbid_unknown_fields=True):
    """普通函数度量明细."""

    file_name: str
    method_name: str
    nbnc_loc: int
    cyclomatic_complexity: int
    start_line: int
    end_line: int


class MethodMaxima(msgspec.Struct, forbid_unknown_fields=True):
    """末尾最大值对象."""

    maximum_cyclomatic_complexity: int
    maximum_nbnc_loc: int


class DuplicationFragment(msgspec.Struct, forbid_unknown_fields=True):
    """代码重复片段."""

    file_name: str
    start_line: int
    code_duplication: int
    end_line: int | None = None


class DetailMetrics(msgspec.Struct, forbid_unknown_fields=True):
    """明细度量对象."""

    file_sizes: dict[str, list[int]]
    method_metrics: list[Any]  # 包含 MethodItem 和位于末尾的 MethodMaxima
    code_duplication: dict[str, list[DuplicationFragment]]
    # 相同内容 MD5 的重复文件组；输入不含内容或 MD5，无法据此核验。
    file_duplication: dict[str, list[str]]
    unsafe_functions: dict[str, dict[str, list[int]]]
    redundant_code: dict[str, list[int]]
    huge_folders: dict[str, int]


class CmetricsReport(msgspec.Struct, forbid_unknown_fields=True):
    """Cmetrics 扫描报告顶级对象."""

    summary_metrics: SummaryMetrics
    detail_metrics: DetailMetrics


HEADER_EXTENSIONS = frozenset({".h", ".hh", ".hpp", ".hxx"})
SOURCE_EXTENSIONS = frozenset({".c", ".cc", ".cpp", ".cxx"})


def is_header_file(path: str) -> bool:
    """判断文件路径是否为 C/C++ 头文件."""
    return any(path.endswith(ext) for ext in HEADER_EXTENSIONS)


def is_source_file(path: str) -> bool:
    """判断文件路径是否为 C/C++ 源文件（非头文件）."""
    return any(path.endswith(ext) for ext in SOURCE_EXTENSIONS)
