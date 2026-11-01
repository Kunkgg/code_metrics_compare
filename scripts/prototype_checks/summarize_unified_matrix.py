"""只读汇合容量逐次样本与相同HTML/输入/查询的完整序列oracle，不覆盖原始记录。"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

from scripts.prototype_checks.run_baseline import dump

METRICS = [
    "code_size",
    "lines_per_file",
    "lines_per_method",
    "cyclomatic_complexity_per_method",
    "code_duplication_ratio",
    "file_duplication_ratio",
    "unsafe_functions_total",
    "redundant_code_total",
    "non_hfile_code_duplication_ratio",
    "non_hfile_duplication_ratio",
    "huge_headerfile_total",
    "huge_headerfile_ratio",
    "huge_non_headerfile_total",
    "huge_non_headerfile_ratio",
    "huge_method_total",
    "huge_method_ratio",
    "huge_cyclomatic_complexity_total",
    "huge_cyclomatic_complexity_ratio",
    "huge_folder_total",
    "huge_folder_ratio",
]
TASKS = {f"metric:{metric}" for metric in METRICS} | {
    "files-first",
    "files-page51",
    "files-last",
    "files-search",
    "methods-page51",
    "methods-last",
    "methods-name",
    "methods-absent",
    "methods-number",
}
REQUIRED_GROUPS = {
    f"{rate}-{shape}" for rate in ("low", "mid", "full") for shape in ("mixed", "wide", "deep")
} | {"churn-mixed"}


def finite_nonnegative(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    )


FIELDS = (
    "scenario",
    "type",
    "directory",
    "exactFile",
    "searchScope",
    "status",
    "sort",
    "query",
    "numberFilter",
)


def signature(state: dict[str, Any]) -> str:
    return json.dumps({key: state.get(key) for key in FIELDS}, sort_keys=True, ensure_ascii=False)


def p95(values: list[Any]) -> float | None:
    return (
        sorted(values)[math.ceil(len(values) * 0.95) - 1]
        if len(values) >= 20 and all(finite_nonnegative(v) for v in values)
        else None
    )


def summarize(measured: dict[str, Any], oracle: dict[str, Any] | None) -> dict[str, Any]:
    runs = measured.get("runs", [])
    artifact_hash = measured.get("artifact", {}).get("sha256")
    matched = bool(
        oracle
        and oracle.get("pass") is True
        and artifact_hash
        and oracle.get("htmlSha256") == artifact_hash
    )
    if matched:
        inputs = measured.get("inputs", [])
        oracle_inputs = (oracle or {}).get("inputs", {})
        matched = len(inputs) >= 2 and all(
            inputs[index].get("sha256")
            and oracle_inputs.get(side, {}).get("sha256") == inputs[index]["sha256"]
            for index, side in enumerate(("baseline", "current"))
        )
    tasks = {
        signature(task.get("state", {})): task
        for task in (oracle or {}).get("tasks", [])
        if task.get("pass") is True
    }
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for run in runs:
        for mode in ("cold", "hot", "soak"):
            for batch in run.get(mode, []):
                for sample in batch:
                    groups.setdefault((mode, sample["task"]), []).append(sample)
    summaries = []
    for (mode, name), samples in groups.items():
        join_errors, dom_errors, no_ids = [], [], 0
        for index, sample in enumerate(samples):
            if "ids" not in sample:
                no_ids += 1
            checked = tasks.get(signature(sample.get("state", {}))) if matched else None
            if checked is None or checked.get("expectedCount") != sample.get("total"):
                join_errors.append(index)
                continue
            if "ids" not in sample:
                continue
            page = next(
                (
                    p
                    for p in checked.get("browserPages", [])
                    if p["page"] == sample["page"] and p["pageSize"] == 10
                ),
                None,
            )
            if page is None or page["expectedIds"] != sample["ids"]:
                dom_errors.append(index)
        value = p95([sample.get("elapsedMs") for sample in samples])
        limit = 3000 if name in ("methods-name", "methods-absent") else 1000
        summaries.append(
            {
                "mode": mode,
                "task": name,
                "count": len(samples),
                "p95Ms": value,
                "limitMs": limit,
                "completeQueryJoined": matched and not join_errors,
                "queryJoinMismatchSamples": join_errors,
                "capturedDomIdsMatch": not join_errors and not dom_errors and no_ids == 0,
                "domIdMismatchSamples": dom_errors,
                "samplesWithoutDomIds": no_ids,
                "withinLatencyLimit": value is not None and value <= limit,
            }
        )
    memory = [run["memory"] for run in runs if "memory" in run]
    starts = [run.get("startup", {}).get("probe", {}).get("readyPaintMs") for run in runs]
    startup_gate = len(starts) == 20 and all(finite_nonnegative(v) and v <= 10000 for v in starts)
    valid_starts = [v for v in starts if finite_nonnegative(v)]
    short = [task for task in summaries if task["mode"] in ("cold", "hot")]
    stable = (
        measured.get("sourcesChangedDuringBuild") is False
        and measured.get("sourcesChangedDuringMeasurement") is False
        and bool(measured.get("sources"))
        and all(source.get("sha256") for source in measured.get("sources", []))
        and bool(measured.get("lock", {}).get("sha256"))
    )

    def complete_batch(batch: list[dict[str, Any]]) -> bool:
        return len(batch) == len(TASKS) and {sample.get("task") for sample in batch} == TASKS

    # 冷样本必须来自20个独立会话；热样本由首会话的20批真实任务提供。
    sample_gate = (
        len(runs) == 20
        and all(
            run.get("status") == "sampled"
            and len(run.get("cold", [])) == 1
            and complete_batch(run["cold"][0])
            for run in runs
        )
        and len(runs[0].get("hot", [])) == 20
        and all(complete_batch(batch) for batch in runs[0]["hot"])
        and all(not run.get("hot") for run in runs[1:])
        and {(task["mode"], task["task"]) for task in short}
        == {(mode, name) for mode in ("cold", "hot") for name in TASKS}
    )
    sampling_errors = sum(m.get("samplingErrorCount", 0) for m in memory)
    resource_gate = (
        bool(memory)
        and len(memory) == len(runs)
        and all(
            m.get("coverageComplete") is True
            and m.get("samplingErrorCount") == 0
            and finite_nonnegative(m.get("baselineRssBytes"))
            and finite_nonnegative(m.get("peakIncrementBytes"))
            and m["peakIncrementBytes"] <= 2 * 1024**3
            for m in memory
        )
    )
    html_bytes = measured.get("artifact", {}).get("bytes")
    html_gate = finite_nonnegative(html_bytes) and 0 < html_bytes <= 200 * 1024**2
    sources_digest = hashlib.sha256(
        json.dumps(
            [*measured.get("sources", []), measured.get("lock", {})], sort_keys=True
        ).encode()
    ).hexdigest()
    return {
        "sourcesDigest": sources_digest,
        "rawStatus": measured.get("status"),
        "sourceStable": stable,
        "inputScale": measured.get("inventory", {}).get("actual"),
        "requiredScaleMet": measured.get("inventory", {}).get("requiredScaleMet"),
        "htmlBytes": measured.get("artifact", {}).get("bytes"),
        "htmlSha256": measured.get("artifact", {}).get("sha256"),
        "packagingSeconds": measured.get("build", {}).get("wallSeconds"),
        "packagingPeakRssBytes": measured.get("build", {}).get("memory", {}).get("peakRssBytes"),
        "coldProfiles": len(runs),
        "startupSamplesMs": starts,
        "startupP95Ms": p95(starts),
        "startupMaxMs": max(valid_starts, default=None),
        "browserIncrementPeakBytes": max(
            (m["peakIncrementBytes"] for m in memory if m.get("peakIncrementBytes") is not None),
            default=None,
        ),
        "browserSamplingErrors": sampling_errors,
        "browserMaxSampleIntervalMs": max(
            (m.get("maxObservedIntervalMs", 0) for m in memory), default=None
        ),
        "oracleArtifactAndInputsMatched": matched,
        "oracleChecks": oracle.get("taskCount") if oracle else None,
        "sampleCountsSufficient": sample_gate,
        "sampledBrowserResourceLimitMet": resource_gate,
        "resourceEvidenceHasReadRaces": sampling_errors > 0,
        "tasks": summaries,
        "localShortQueryAndLatencyGate": measured.get("inventory", {}).get(
            "requiredScaleMet", False
        )
        and measured.get("status") == "measured-not-accepted"
        and startup_gate
        and html_gate
        and stable
        and sample_gate
        and resource_gate
        and all(
            task["completeQueryJoined"]
            and task["withinLatencyLimit"]
            and task["capturedDomIdsMatch"]
            for task in short
        ),
        "businessValidationAccepted": False,
        "acceptanceStatus": "not-accepted",
        "limitations": [
            "仅汇合明细查询；未联合净影响、关联证据、完整管线和长时验收",
            "数值条件任务未采集DOM行ID；完整Worker查询仍以独立oracle核验",
            "RSS为进程树抽样差分，读取竞态/共享页重计/瞬时峰值漏采保留",
            "冷样本为独立profile首次任务，前序任务可能建立共享索引，OS缓存未控制",
            "完整L1/L2生成管线与长时独立记录；Windows Chrome/Edge及macOS Edge未测",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    output = args.directory.resolve()
    if not output.is_dir():
        parser.error("汇总目录必须已存在")
    result: dict[str, Any] = {
        "protocol": "joined-capacity-1",
        "groups": {},
        "compatibilityAccepted": False,
        "businessValidationAccepted": False,
        "acceptanceStatus": "not-accepted",
        "unmeasured": ["Windows Chrome", "Windows Edge", "macOS Edge"],
    }
    for path in sorted((output / "short").glob("*/results.json")):
        name = path.parent.name
        oracle_path = output / f"stage5-oracle-{name}/result.json"
        oracle = json.loads(oracle_path.read_text()) if oracle_path.exists() else None
        result["groups"][name] = summarize(json.loads(path.read_text()), oracle)
    soak_path = output / "soak/full-mixed/results.json"
    if soak_path.exists():
        soak = json.loads(soak_path.read_text())
        result["soak"] = {
            "durationSufficient": soak.get("soakDurationSufficient", False),
            "status": soak.get("status"),
            "sourcesStable": soak.get("sourcesChangedDuringBuild") is False
            and soak.get("sourcesChangedDuringMeasurement") is False,
            "acceptanceStatus": "not-accepted",
            "artifactMatchesShort": bool(soak.get("artifact", {}).get("sha256"))
            and soak.get("artifact", {}).get("sha256")
            == result["groups"].get("full-mixed", {}).get("htmlSha256"),
            "artifactSha256": soak.get("artifact", {}).get("sha256"),
            "sessions": [
                {
                    "seconds": r.get("soakElapsedSeconds"),
                    "memory": r.get("memory"),
                    "trend": r.get("soakMemory"),
                    "error": r.get("error"),
                }
                for r in soak.get("runs", [])
            ],
            "summary": soak.get("summaries", {}).get("soak", []),
        }
    result["sameSourcesAcrossGroups"] = (
        len({group["sourcesDigest"] for group in result["groups"].values()}) == 1
    )
    result["allTenShortGroupsComplete"] = (
        set(result["groups"]) == REQUIRED_GROUPS
        and result["sameSourcesAcrossGroups"]
        and all(group["localShortQueryAndLatencyGate"] for group in result["groups"].values())
    )
    dump(output / "assessment.json", result)
    print(
        json.dumps(
            {
                "groups": len(result["groups"]),
                "localShortGatesMet": sum(
                    g["localShortQueryAndLatencyGate"] for g in result["groups"].values()
                ),
                "compatibilityAccepted": False,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
