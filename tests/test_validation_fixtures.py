"""Schema、公式和内容证据的夹具校验；不作为 golden 业务验收。"""

import hashlib
import json
from pathlib import Path

import pytest

from cmetrics_cmp_viz.validator import validate_l0, validate_l1, validate_l2

VALIDATION = Path(__file__).parent / "fixtures" / "validation"
CASES = sorted(
    path
    for path in VALIDATION.iterdir()
    if (path / "expected.json").is_file() and path.name != "file-content-evidence"
)


@pytest.mark.parametrize("case", CASES, ids=lambda path: path.name)
@pytest.mark.parametrize("side", ["baseline", "current"])
def test_validation_fixture_contract(case: Path, side: str) -> None:
    """校验正常边界公式和明确构造的 L1/L2 负例。"""
    expected = json.loads((case / "expected.json").read_text(encoding="utf-8"))
    report, errors = validate_l0((case / f"{side}.json").read_bytes())
    assert errors == []
    assert report is not None
    expected_summary = expected["summaries"][side]
    assert {key: report["summary_metrics"].get(key) for key in expected_summary} == expected_summary
    assert report["detail_metrics"]["method_metrics"][-1] == expected["maxima"][side]

    validation = expected["validation"][side]
    l1_errors = validate_l1(report)
    assert len(l1_errors) == len(validation["L1"]), l1_errors
    for fragment in validation["L1"]:
        assert any(fragment in error for error in l1_errors), l1_errors
    if validation["L2"] is None:
        assert l1_errors, "结构无效时不调用假定结构有效的 L2 校验器"
        return
    assert l1_errors == []
    l2_errors = validate_l2(report)
    assert len(l2_errors) == len(validation["L2"]), l2_errors
    for fragment in validation["L2"]:
        assert any(fragment in error for error in l2_errors), l2_errors


@pytest.mark.parametrize("side", ["baseline", "current"])
def test_file_content_evidence(side: str) -> None:
    """按实际文件核对内容约束，不将其混入业务对比预期。"""
    case = VALIDATION / "file-content-evidence"
    expected = json.loads((case / "expected.json").read_text(encoding="utf-8"))
    report = json.loads((case / f"{side}.json").read_text(encoding="utf-8"))
    detail = report["detail_metrics"]
    for members in detail["file_duplication"].values():
        contents = []
        for member in members:
            content = (case / expected["content_evidence"][side][member]).read_bytes()
            assert hashlib.md5(content).hexdigest() == expected["content_md5"][side]
            lines = content.splitlines()
            # 本夹具仅含全局 int 声明与整行注释，不实现源码扫描器。
            code_lines = sum(line.startswith(b"int ") for line in lines)
            assert detail["file_sizes"][member] == [code_lines, len(lines), code_lines]
            contents.append(content)
        assert len(contents) >= 2
        assert all(content == contents[0] for content in contents)
