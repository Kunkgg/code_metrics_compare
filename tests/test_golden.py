"""已人工确认的固定预期驱动真实查询；工程约束由独立测试覆盖。"""

import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
GOLDEN = ROOT / "tests" / "fixtures" / "golden"
CASES = sorted(path for path in GOLDEN.iterdir() if path.is_dir())
EXPECTED = {
    case.name: json.loads((case / "expected.json").read_text(encoding="utf-8")) for case in CASES
}
REGISTRY = json.loads((ROOT / "tests/business_known_gaps.json").read_text(encoding="utf-8"))
KNOWN_GAPS = {(item["fixture"], item["check"]): item for item in REGISTRY["failures"]}


def digest(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def business_checks() -> list[Any]:
    """按固定预期枚举每个断言，只对明确登记的实现差距标记预期失败。"""
    parameters = []
    for case in CASES:
        expected = EXPECTED[case.name]
        names = ["summary." + metric for metric in expected.get("summary_comparison", {})]
        for query in expected["queries"]:
            names.extend([query["name"], query["name"] + ".total"])
            if query.get("threshold_warning"):
                names.append(query["name"] + ".threshold-warning")
        for name in names:
            gap = KNOWN_GAPS.get((case.name, name))
            marks = (
                [pytest.mark.xfail(reason=gap["reason"], strict=True, raises=AssertionError)]
                if gap
                else []
            )
            parameters.append(
                pytest.param(case.name, name, id=case.name + "::" + name, marks=marks)
            )
    return parameters


@pytest.mark.parametrize("case", CASES, ids=lambda path: path.name)
def test_golden_review_record(case: Path) -> None:
    expected = EXPECTED[case.name]
    assert expected["review_status"] == "approved", "新修订须先记录人工确认范围"
    review = expected["review"]
    assert review["reviewer"] and review["decision"] in {"OK", "整体无异议"}
    assert (case / review["basis"].split("#", 1)[0]).is_file()
    for side, approved_digest in review.get("input_sha256", {}).items():
        assert hashlib.sha256((case / f"{side}.json").read_bytes()).hexdigest() == approved_digest
    if "business_sha256" in review:
        business = {
            key: value
            for key, value in expected.items()
            if key not in {"review", "review_status", "provenance"}
        }
        assert digest(business) == review["business_sha256"], "业务预期改变须重新记录确认范围"


@pytest.fixture(scope="session")
def business_results() -> dict[tuple[str, str], dict[str, Any]]:
    node = shutil.which("node")
    if node is None:
        pytest.skip("业务查询夹具需要 Node.js")
    result = subprocess.run(
        [
            node,
            str(ROOT / "scripts/prototype_checks/check-business-fixture.cjs"),
            "--all-results",
            *map(str, CASES),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode not in (0, 1):
        pytest.fail(result.stdout + result.stderr)
    try:
        report = json.loads(result.stdout)
        results = {(item["fixture"], item["name"]): item for item in report["results"]}
    except (ValueError, KeyError, TypeError):
        pytest.fail("业务查询入口未返回完整结果：" + result.stdout + result.stderr)
    expected_keys = set()
    for case, expected in EXPECTED.items():
        expected_keys.update(
            (case, "summary." + metric) for metric in expected.get("summary_comparison", {})
        )
        for query in expected["queries"]:
            expected_keys.update([(case, query["name"]), (case, query["name"] + ".total")])
            if query.get("threshold_warning"):
                expected_keys.add((case, query["name"] + ".threshold-warning"))
    if set(results) != expected_keys or len(report["results"]) != len(expected_keys):
        pytest.fail("业务查询结果缺失、重复或出现未登记断言")
    if not set(KNOWN_GAPS) <= expected_keys:
        pytest.fail("存在已移除断言的过期实现差距登记")
    if report["failed"] != sum(not item["pass"] for item in results.values()):
        pytest.fail("业务查询失败数量与逐项结果不一致")
    return results


@pytest.mark.parametrize("case, name", business_checks())
def test_reviewed_business_comparison(
    case: str, name: str, business_results: dict[tuple[str, str], dict[str, Any]]
) -> None:
    result = business_results[(case, name)]
    gap = KNOWN_GAPS.get((case, name))
    if gap and not result["pass"]:
        shape = {key: result[key] for key in ("expected", "actual")}
        if digest(shape) != gap["failure_sha256"]:
            # pytest.fail 不会被 raises=AssertionError 吞掉，避免新回归混入旧差距。
            pytest.fail("已知实现差距的失败形态发生变化：" + json.dumps(result, ensure_ascii=False))
    assert result["pass"], json.dumps(result, ensure_ascii=False)
