"""根据 docs/mock-data-generation.md §7 要求的正确性夹具最小集进行专项验证."""

from decimal import ROUND_HALF_UP, Decimal

import msgspec
import pytest

from cmetrics_cmp_viz.generator import GeneratorConfig, MockDataGenerator
from cmetrics_cmp_viz.validator import (
    compute_common_root,
    validate_l1,
    validate_l2,
)


class TestSpecialFixtures:
    """特殊场景与边界正例测试."""

    def test_fixture_1_empty_scan(self):
        """正例 1: 空扫描.

        无文件；method_metrics 仅含双 0 尾对象；空容器 {}；folders_total = 0.
        """
        report = {
            "summary_metrics": {
                "code_size": 0,
                "raw_lines": 0,
                "methods_total": 0,
                "cyclomatic_complexity_total": 0,
                "cyclomatic_complexity_per_method": 0.0,
                "maximum_cyclomatic_complexity": 0,
                "huge_cyclomatic_complexity_total": 0,
                "huge_cyclomatic_complexity_ratio": 0.0,
                "method_lines": 0,
                "lines_per_method": 0.0,
                "huge_method_total": 0,
                "huge_method_ratio": 0.0,
                "files_total": 0,
                "folders_total": 0,
                "lines_per_file": 0.0,
                "huge_headerfile_total": 0,
                "huge_headerfile_ratio": 0.0,
                "huge_non_headerfile_total": 0,
                "huge_non_headerfile_ratio": 0.0,
                "huge_folder_total": 0,
                "huge_folder_ratio": 0.0,
                "file_duplication_total": 0,
                "file_duplication_ratio": 0.0,
                "non_hfile_duplication_total": 0,
                "non_hfile_duplication_ratio": 0.0,
                "code_duplication_total": 0,
                "code_duplication_ratio": 0.0,
                "non_hfile_code_duplication_total": 0,
                "non_hfile_code_duplication_ratio": 0.0,
                "unsafe_functions_total": 0,
                "unsafe_functions_kloc": 0.0,
                "redundant_code_total": 0,
                "redundant_code_kloc": 0.0,
                "cmetrics_version": "mock-scan-v1.0.0",
                "huge_threshold": {
                    "huge_headerfile": 500,
                    "huge_non_headerfile": 2000,
                    "huge_method": 50,
                    "huge_cyclomatic_complexity": 20,
                    "huge_folder": 50,
                },
                "command": "cmetrics -fp /workspace/empty_proj -l clike",
            },
            "detail_metrics": {
                "file_sizes": {},
                "method_metrics": [
                    {
                        "maximum_cyclomatic_complexity": 0,
                        "maximum_nbnc_loc": 0,
                    }
                ],
                "code_duplication": {},
                "file_duplication": {},
                "unsafe_functions": {},
                "redundant_code": {},
                "huge_folders": {},
            },
        }

        assert validate_l1(report) == []
        assert validate_l2(report) == []

    def test_fixture_2_comments_only_files(self):
        """正例 2: 仅注释/空白文件.

        r_f > 0, n_f = 0; lines_per_file = 0.
        """
        report = {
            "summary_metrics": {
                "code_size": 0,
                "raw_lines": 100,
                "methods_total": 0,
                "cyclomatic_complexity_total": 0,
                "cyclomatic_complexity_per_method": 0.0,
                "maximum_cyclomatic_complexity": 0,
                "huge_cyclomatic_complexity_total": 0,
                "huge_cyclomatic_complexity_ratio": 0.0,
                "method_lines": 0,
                "lines_per_method": 0.0,
                "huge_method_total": 0,
                "huge_method_ratio": 0.0,
                "files_total": 1,
                "folders_total": 1,
                "lines_per_file": 0.0,
                "huge_headerfile_total": 0,
                "huge_headerfile_ratio": 0.0,
                "huge_non_headerfile_total": 0,
                "huge_non_headerfile_ratio": 0.0,
                "huge_folder_total": 0,
                "huge_folder_ratio": 0.0,
                "file_duplication_total": 0,
                "file_duplication_ratio": 0.0,
                "non_hfile_duplication_total": 0,
                "non_hfile_duplication_ratio": 0.0,
                "code_duplication_total": 0,
                "code_duplication_ratio": 0.0,
                "non_hfile_code_duplication_total": 0,
                "non_hfile_code_duplication_ratio": 0.0,
                "unsafe_functions_total": 0,
                "unsafe_functions_kloc": 0.0,
                "redundant_code_total": 0,
                "redundant_code_kloc": 0.0,
                "cmetrics_version": "mock-scan-v1.0.0",
                "huge_threshold": {
                    "huge_headerfile": 500,
                    "huge_non_headerfile": 2000,
                    "huge_method": 50,
                    "huge_cyclomatic_complexity": 20,
                    "huge_folder": 50,
                },
                "command": "cmetrics -fp /workspace/proj -l clike",
            },
            "detail_metrics": {
                "file_sizes": {
                    "/workspace/proj/only_comments.c": [0, 100, 0],
                },
                "method_metrics": [
                    {
                        "maximum_cyclomatic_complexity": 0,
                        "maximum_nbnc_loc": 0,
                    }
                ],
                "code_duplication": {},
                "file_duplication": {},
                "unsafe_functions": {},
                "redundant_code": {},
                "huge_folders": {},
            },
        }

        assert validate_l1(report) == []
        assert validate_l2(report) == []

    @pytest.mark.parametrize(
        "code_size, expected_redundant", [(999, 0.00), (1000, 2.00), (1001, 2.00)]
    )
    def test_fixture_5_density_boundary_999_1000_1001(self, code_size, expected_redundant):
        """密度舍入不改变低代码量规则，unsafe 密度不套用该规则。"""
        report, _ = MockDataGenerator(GeneratorConfig(num_files=0)).generate_single_report()
        path = "/workspace/project/src/boundary.c"
        detail = report["detail_metrics"]
        detail["file_sizes"] = {path: [code_size, code_size, 0]}
        detail["unsafe_functions"] = {path: {"strcpy": [1]}}
        detail["redundant_code"] = {path: [2, 3]}
        summary = report["summary_metrics"]
        summary.update(
            code_size=code_size,
            raw_lines=code_size,
            files_total=1,
            folders_total=1,
            lines_per_file=float(code_size),
            unsafe_functions_total=1,
            unsafe_functions_kloc=1.00,
            redundant_code_total=2,
            redundant_code_kloc=expected_redundant,
        )
        assert validate_l1(report) == []
        assert validate_l2(report) == []
        # 旧六位值在 999/1001 边界都必须拒绝，不能先舍入输入再比较。
        if code_size != 1000:
            summary["unsafe_functions_kloc"] = 1.001001 if code_size == 999 else 0.999001
            assert any("unsafe_functions_kloc 复算不符" in e for e in validate_l2(report))
            summary["unsafe_functions_kloc"] = 1.00
        if code_size == 1001:
            summary["redundant_code_kloc"] = 1.998002
            assert any("redundant_code_kloc 复算不符" in e for e in validate_l2(report))

    def test_fixture_common_root_and_multiple_fp(self):
        """正例 9: 多路径 -fp 参数与公共根计算."""
        paths = ["/repo/module-a", "/repo/module-b"]
        root = compute_common_root(paths)
        assert root == "/repo"

        paths2 = ["/workspace/proj/src/core", "/workspace/proj/src/utils"]
        root2 = compute_common_root(paths2)
        assert root2 == "/workspace/proj/src"

    def test_fixture_determinism_with_same_seed(self):
        """验证同 seed 两次生成完全一致 (确定性)."""
        cfg1 = GeneratorConfig(seed=999, num_files=8)
        gen1 = MockDataGenerator(cfg1)
        r1, _ = gen1.generate_single_report()

        cfg2 = GeneratorConfig(seed=999, num_files=8)
        gen2 = MockDataGenerator(cfg2)
        r2, _ = gen2.generate_single_report()

        assert r1 == r2

    def test_fixture_baseline_and_current_change_ledger(self):
        """验证 baseline/current 变化对与变化台账."""
        cfg = GeneratorConfig(seed=100, num_files=10)
        gen = MockDataGenerator(cfg)
        b_report, c_report, ledger = gen.generate_baseline_and_current()

        assert validate_l1(b_report) == []
        assert validate_l2(b_report) == []
        assert validate_l1(c_report) == []
        assert validate_l2(c_report) == []
        assert len(ledger) > 0

        # 校验台账条目格式
        for entry in ledger:
            assert "target" in entry
            assert "type" in entry
            assert "field" in entry


@pytest.mark.parametrize("seed", [42, 123, 999])
def test_generator_float_outputs_rounded_from_counts(seed):
    """独立使用原始计数复算全部浮点指标，并验证序列化后的两位精度。"""
    report, _ = MockDataGenerator(GeneratorConfig(seed=seed, num_files=12)).generate_single_report()
    summary = report["summary_metrics"]
    denominators = {
        "huge_cyclomatic_complexity": "methods_total",
        "huge_method": "methods_total",
        "huge_headerfile": "files_total",
        "huge_non_headerfile": "files_total",
        "huge_folder": "folders_total",
        "file_duplication": "files_total",
        "non_hfile_duplication": "files_total",
        "code_duplication": "code_size",
        "non_hfile_code_duplication": "code_size",
    }
    for prefix, denominator in denominators.items():
        expected = (
            Decimal(summary[f"{prefix}_total"]) / Decimal(summary[denominator]) * 100
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        assert summary[f"{prefix}_ratio"] == float(expected)
    for name, numerator, denominator, multiplier in (
        ("cyclomatic_complexity_per_method", "cyclomatic_complexity_total", "methods_total", 1),
        ("lines_per_method", "method_lines", "methods_total", 1),
        ("lines_per_file", "code_size", "files_total", 1),
        ("unsafe_functions_kloc", "unsafe_functions_total", "code_size", 1000),
        ("redundant_code_kloc", "redundant_code_total", "code_size", 1000),
    ):
        expected = (
            Decimal(summary[numerator]) / Decimal(summary[denominator]) * multiplier
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if name == "redundant_code_kloc" and summary["code_size"] < 1000:
            expected = Decimal(0)
        assert summary[name] == float(expected)
    # JSON 数值允许省略尾零；编码解码后仍应等于两位量化值。
    decoded = msgspec.json.decode(msgspec.json.encode(report))["summary_metrics"]
    for value in decoded.values():
        if isinstance(value, float):
            decimal_value = Decimal(str(value))
            assert decimal_value == decimal_value.quantize(Decimal("0.01"))
    assert validate_l2(report) == []
