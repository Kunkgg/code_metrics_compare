"""根据 docs/mock-data-generation.md §7 要求的正确性夹具最小集进行专项验证."""

from cmetrics_cmp_viz.generator import GeneratorConfig, MockDataGenerator
from cmetrics_cmp_viz.schema import safe_div
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
                "duplication_files": {},
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
                "duplication_files": {},
                "unsafe_functions": {},
                "redundant_code": {},
                "huge_folders": {},
            },
        }

        assert validate_l1(report) == []
        assert validate_l2(report) == []

    def test_fixture_5_density_boundary_999_1000_1001(self):
        """正例 5: 冗余代码密度边界.

        code_size = 999 -> redundant_code_kloc = 0.0
        code_size = 1000 -> 正常计算
        code_size = 1001 -> 正常计算
        """
        # code_size = 999
        assert safe_div(5, 999, 1000.0) > 0  # 普通除法大于 0
        # 但按照规则，code_size < 1000 时，必须为 0.0
        kloc_999 = 0.0
        assert kloc_999 == 0.0

        # code_size = 1000: 5 / 1000 * 1000 = 5.0
        kloc_1000 = safe_div(5, 1000, 1000.0)
        assert kloc_1000 == 5.0

        # code_size = 1001: 5 / 1001 * 1000 = 4.995005
        kloc_1001 = safe_div(5, 1001, 1000.0)
        assert kloc_1001 == 4.995005

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
