"""测试 L0–L3 校验器的行为与拦截能力."""

from cmetrics_cmp_viz.generator import GeneratorConfig, MockDataGenerator
from cmetrics_cmp_viz.validator import (
    validate_l0,
    validate_l1,
    validate_l2,
    validate_l3,
)


def get_valid_sample() -> tuple[dict, dict]:
    """获取一个完全合法的生成样本及内部模型."""
    cfg = GeneratorConfig(seed=123, num_files=10)
    gen = MockDataGenerator(cfg)
    return gen.generate_single_report()


class TestL0Validator:
    """L0 校验测试."""

    def test_valid_json(self):
        valid_json = '{"a": 1, "b": [2, 3]}'
        data, errs = validate_l0(valid_json)
        assert errs == []
        assert data == {"a": 1, "b": [2, 3]}

    def test_duplicate_key_rejected(self):
        dup_json = '{"key": 1, "key": 2}'
        data, errs = validate_l0(dup_json)
        assert data is None
        assert any("重复的对象键" in e for e in errs)

    def test_nan_infinity_rejected(self):
        nan_json = '{"val": NaN}'
        data, errs = validate_l0(nan_json)
        assert data is None
        assert any("non-standard constant" in e for e in errs)

        inf_json = '{"val": Infinity}'
        data, errs = validate_l0(inf_json)
        assert data is None
        assert any("non-standard constant" in e for e in errs)


class TestL1Validator:
    """L1 校验测试 (Schema 契约)."""

    def test_valid_report_passes_l1(self):
        report, _ = get_valid_sample()
        errs = validate_l1(report)
        assert errs == []

    def test_missing_required_field_rejected(self):
        report, _ = get_valid_sample()
        del report["summary_metrics"]["command"]
        errs = validate_l1(report)
        assert len(errs) > 0
        assert any("command" in e for e in errs)

    def test_unknown_field_rejected(self):
        report, _ = get_valid_sample()
        report["summary_metrics"]["unexpected_field"] = 123
        errs = validate_l1(report)
        assert len(errs) > 0

    def test_empty_method_metrics_rejected(self):
        report, _ = get_valid_sample()
        report["detail_metrics"]["method_metrics"] = []
        errs = validate_l1(report)
        assert len(errs) > 0

    def test_file_sizes_tuple_length_rejected(self):
        report, _ = get_valid_sample()
        first_key = next(iter(report["detail_metrics"]["file_sizes"]))
        report["detail_metrics"]["file_sizes"][first_key] = [10, 20]  # 只有 2 个元素
        errs = validate_l1(report)
        assert len(errs) > 0

    def test_percentage_over_100_rejected(self):
        report, _ = get_valid_sample()
        report["summary_metrics"]["code_duplication_ratio"] = 105.0
        errs = validate_l1(report)
        assert len(errs) > 0


class TestL2Validator:
    """L2 校验测试 (语义与数学复算)."""

    def test_valid_report_passes_l2(self):
        report, _ = get_valid_sample()
        errs = validate_l2(report)
        assert errs == []

    def test_tail_object_not_at_end_rejected(self):
        """L1 接受恰含一个尾对象，但 L2 要求必须位于末尾."""
        report, _ = get_valid_sample()
        methods = report["detail_metrics"]["method_metrics"]
        if len(methods) >= 2:
            # 交换最后两个位置，把最大值对象调到倒数第二
            methods[-1], methods[-2] = methods[-2], methods[-1]
            # L1 应通过（因为依然恰好包含 1 个最大值对象）
            assert validate_l1(report) == []
            # L2 必须拒绝！
            errs = validate_l2(report)
            assert any("必须是最大值对象" in e or "非末尾的最大值对象" in e for e in errs)

    def test_max_cc_mismatch_rejected(self):
        report, _ = get_valid_sample()
        tail = report["detail_metrics"]["method_metrics"][-1]
        tail["maximum_cyclomatic_complexity"] += 999
        errs = validate_l2(report)
        assert any("maximum_cyclomatic_complexity" in e for e in errs)

    def test_summary_metric_mismatch_rejected(self):
        report, _ = get_valid_sample()
        report["summary_metrics"]["code_size"] += 10
        errs = validate_l2(report)
        assert any("code_size 复算不符" in e for e in errs)

    def test_reference_to_missing_file_rejected(self):
        report, _ = get_valid_sample()
        # 让一个函数引用不存在的文件
        if len(report["detail_metrics"]["method_metrics"]) > 1:
            report["detail_metrics"]["method_metrics"][0]["file_name"] = (
                "/workspace/project/src/non_existent.c"
            )
            errs = validate_l2(report)
            assert any("引用不存在的文件" in e for e in errs)

    def test_path_outside_scan_paths_rejected(self):
        report, _ = get_valid_sample()
        first_key = next(iter(report["detail_metrics"]["file_sizes"]))
        val = report["detail_metrics"]["file_sizes"].pop(first_key)
        out_path = "/other_dir/external.c"
        report["detail_metrics"]["file_sizes"][out_path] = val
        errs = validate_l2(report)
        assert any("不在 -fp 扫描范围内" in e for e in errs)

    def test_method_line_range_rejected(self):
        report, _ = get_valid_sample()
        methods = report["detail_metrics"]["method_metrics"]
        if len(methods) > 1:
            # end_line 超出 raw_line
            methods[0]["end_line"] = 999999
            errs = validate_l2(report)
            assert any("行号范围非法" in e for e in errs)

    def test_file_sizes_tuple_order_rejected(self):
        report, _ = get_valid_sample()
        first_key = next(iter(report["detail_metrics"]["file_sizes"]))
        # 让 dup > nbnc
        report["detail_metrics"]["file_sizes"][first_key] = [10, 50, 20]
        errs = validate_l2(report)
        assert any("违反 0 <= code_duplication" in e for e in errs)

    def test_huge_folders_mismatch_rejected(self):
        report, _ = get_valid_sample()
        report["detail_metrics"]["huge_folders"]["/fake/huge/dir"] = 99
        errs = validate_l2(report)
        assert any("huge_folders 与文件树复算不一致" in e for e in errs)


class TestL3Validator:
    """L3 校验测试 (内部模型与覆盖并集)."""

    def test_valid_l3(self):
        report, int_model = get_valid_sample()
        errs = validate_l3(report, int_model)
        assert errs == []

    def test_dup_lines_union_mismatch_rejected(self):
        report, int_model = get_valid_sample()
        # 故意篡改内部模型的覆盖并集
        first_key = next(iter(int_model["file_models"]))
        int_model["file_models"][first_key]["dup_lines_union"].append(99999)
        errs = validate_l3(report, int_model)
        assert any("内部重复行覆盖并集大小" in e for e in errs)
