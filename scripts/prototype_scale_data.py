"""大规模原型扫描：紧凑规则合成，返回原始报告，不创建逐有效行的 L3 模型。

有效物理行严格为 range(1, 2*n, 2)，偶数行是注释/空白。
函数定义占一个有效行且不计入函数 nbnc_loc，函数体区间互不相交。
重复片段在有效行序列中的半开区间为 [10, 50) 和 [30, 70)，
并集恰为 60 行；整文件重复成员覆盖 [0, n)。这些规则可复算，
但本模块不声称通过现有逐行内部模型的全量 L3 校验。
"""

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path
from typing import Any

from cmetrics_cmp_viz.schema import is_header_file, safe_div
from prototypes.resource_usage import peak_rss_mib
from prototypes.ui.prototype_data import ROOT, THRESHOLDS


def _summarize(detail: dict[str, Any], directory_count: int) -> dict[str, Any]:
    """只从已完成的明细派生 33 项汇总，不预设期望总量。"""
    files = detail["file_sizes"]
    methods = detail["method_metrics"][:-1]
    sources = {p for p in files if not is_header_file(p)}
    dup_files = {p for group in detail["duplication_files"].values() for p in group}
    summary = {
        "code_size": sum(v[0] for v in files.values()),
        "raw_lines": sum(v[1] for v in files.values()),
        "files_total": len(files),
        "folders_total": directory_count,
        "methods_total": len(methods),
        "method_lines": sum(m["nbnc_loc"] for m in methods),
        "cyclomatic_complexity_total": sum(m["cyclomatic_complexity"] for m in methods),
        "maximum_cyclomatic_complexity": detail["method_metrics"][-1][
            "maximum_cyclomatic_complexity"
        ],
        "huge_cyclomatic_complexity_total": sum(
            m["cyclomatic_complexity"] > THRESHOLDS["huge_cyclomatic_complexity"] for m in methods
        ),
        "huge_method_total": sum(m["nbnc_loc"] > THRESHOLDS["huge_method"] for m in methods),
        "huge_headerfile_total": sum(
            v[0] > THRESHOLDS["huge_headerfile"] for p, v in files.items() if is_header_file(p)
        ),
        "huge_non_headerfile_total": sum(
            files[p][0] > THRESHOLDS["huge_non_headerfile"] for p in sources
        ),
        "huge_folder_total": len(detail["huge_folders"]),
        "file_duplication_total": len(dup_files),
        "non_hfile_duplication_total": sum(p in sources for p in dup_files),
        "code_duplication_total": sum(v[2] for v in files.values()),
        "non_hfile_code_duplication_total": sum(files[p][2] for p in sources),
        "unsafe_functions_total": sum(
            len(lines) for names in detail["unsafe_functions"].values() for lines in names.values()
        ),
        "redundant_code_total": sum(len(lines) for lines in detail["redundant_code"].values()),
    }
    for name, numerator, denominator, multiplier in [
        ("lines_per_file", "code_size", "files_total", 1),
        ("lines_per_method", "method_lines", "methods_total", 1),
        ("cyclomatic_complexity_per_method", "cyclomatic_complexity_total", "methods_total", 1),
        *[
            (f"{prefix}_ratio", f"{prefix}_total", denom, 100)
            for prefix, denom in [
                ("huge_cyclomatic_complexity", "methods_total"),
                ("huge_method", "methods_total"),
                ("huge_headerfile", "files_total"),
                ("huge_non_headerfile", "files_total"),
                ("huge_folder", "folders_total"),
                ("file_duplication", "files_total"),
                ("non_hfile_duplication", "files_total"),
                ("code_duplication", "code_size"),
                ("non_hfile_code_duplication", "code_size"),
            ]
        ],
        ("unsafe_functions_kloc", "unsafe_functions_total", "code_size", 1000),
        ("redundant_code_kloc", "redundant_code_total", "code_size", 1000),
    ]:
        summary[name] = safe_div(summary[numerator], summary[denominator], multiplier)
    if summary["code_size"] < 1000:
        summary["redundant_code_kloc"] = 0
    return {
        **summary,
        "huge_threshold": dict(THRESHOLDS),
        "cmetrics_version": "mock-scan-v1.0.0",
        "command": f"cmetrics -fp {ROOT} -l clike",
    }


def generate_scale_side(
    num_files: int = 100_000,
    seed: int = 20261021,
    current: bool = False,
    change_rate: float = 1.0,
    shape: str = "mixed",
    *,
    churn_rate: float = 0.02,
    duplicate_group_size: int = 10_000,
    ambiguity_rate: float = 0.2,
    long_names: bool = True,
) -> dict[str, Any]:
    """生成精确 N 文件、10N 函数；同 seed/config 两侧共享基础随机序列。

    前 floor(N*change_rate) 个编号发生数值变化，其中前
    floor(N*min(churn_rate, change_rate)) 个编号更换路径，保持各侧基数。
    churn_rate 为每侧移出/新增数占 N 的比例；共同路径的修改率与总变化率分开记录。
    wide 每目录最多约 8 文件，deep 使用 24 层，mixed 混合宽、深及集中目录。
    大重复组包含 min(N, duplicate_group_size) 个文件，0/1 时不生成重复组。
    """
    if isinstance(num_files, bool) or not isinstance(num_files, int) or num_files < 0:
        raise ValueError("num_files 必须是非负整数")
    if shape not in {"wide", "deep", "mixed"}:
        raise ValueError("shape 必须为 wide、deep 或 mixed")
    for name, value, upper in (
        ("change_rate", change_rate, 1),
        ("churn_rate", churn_rate, 0.2),
        ("ambiguity_rate", ambiguity_rate, 1),
    ):
        if not math.isfinite(value) or not 0 <= value <= upper:
            raise ValueError(f"{name} 必须位于 0..{upper}")
    if not isinstance(duplicate_group_size, int) or duplicate_group_size < 0:
        raise ValueError("duplicate_group_size 必须为非负整数")
    rng = random.Random(seed)
    changed_count = int(num_files * change_rate)
    churn_count = int(num_files * min(churn_rate, change_rate))
    group_size = min(num_files, duplicate_group_size)
    if group_size < 2:
        group_size = 0
    files: dict[str, list[int]] = {}
    methods: list[dict[str, Any]] = []
    fragments_a: list[dict[str, Any]] = []
    fragments_b: list[dict[str, Any]] = []
    whole_members: list[str] = []
    unsafe: dict[str, Any] = {}
    redundant: dict[str, list[int]] = {}
    # 每个目录仅首次访问时向父目录登记一次，不扫描文件全集。
    directory_items: dict[str, int] = {}

    def register_directory(directory: str) -> None:
        if directory in directory_items:
            return
        directory_items[directory] = 0
        if directory != ROOT:
            parent = directory.rsplit("/", 1)[0]
            register_directory(parent)
            directory_items[parent] += 1

    suffix = "_long_descriptive_component_for_navigation" if long_names else ""
    deep = "/".join(f"layer_{j:02}{suffix if j == 12 else ''}" for j in range(24))
    names = [f"function_{j:02}{suffix}" for j in range(10)]
    ambiguous_name = f"func_worker{suffix}"
    for i in range(num_files):
        branch = shape if shape != "mixed" else ("wide", "deep", "dense")[i % 3]
        if branch == "wide":
            directory = f"{ROOT}/src/wide/bucket_{i // 8:06}"
        elif branch == "deep":
            directory = f"{ROOT}/src/deep/{deep}/bucket_{i // 256:06}"
        else:
            directory = f"{ROOT}/src/bulk"
        extension = ".h" if i % 5 == 0 else ".c"
        marker = "added" if current and i < churn_count else "unit"
        path = f"{directory}/{marker}_{i:06}{suffix}{extension}"
        register_directory(directory)
        directory_items[directory] += 1
        changed = current and i < changed_count
        delta = 1 if changed else 0
        # 每文件至少 1000 有效行，10 万规模至少一亿行。
        count = rng.randint(1000, 2600) + delta * 20
        ambiguous = rng.random() < ambiguity_rate
        files[path] = [count, count * 2 + 20, 0]
        offset = 0
        for j in range(10):
            length = rng.randint(20, 65) + delta
            complexity = rng.randint(1, 30) + delta
            methods.append(
                {
                    "file_name": path,
                    "method_name": ambiguous_name if ambiguous and j < 2 else names[j],
                    "nbnc_loc": length,
                    "cyclomatic_complexity": complexity,
                    "start_line": offset * 2 + 1,
                    "end_line": (offset + length) * 2 + 1,
                }
            )
            offset += length + 2
        if i < group_size:
            fragments_a.append({"file_name": path, "start_line": 21, "code_duplication": 40})
            fragments_b.append({"file_name": path, "start_line": 61, "code_duplication": 40})
            files[path][2] = 60
        if i < min(group_size, max(2, group_size // 10)):
            whole_members.append(path)
            files[path][2] = count
        if i % 10 == 0:
            unsafe[path] = {"strcpy": [151 + delta * 2, 211]}
            redundant[path] = [302 + delta * 2]
    methods.sort(key=lambda m: (m["file_name"], m["start_line"]))
    methods.append(
        {
            "maximum_cyclomatic_complexity": max(
                (m["cyclomatic_complexity"] for m in methods), default=0
            ),
            "maximum_nbnc_loc": max((m["nbnc_loc"] for m in methods), default=0),
        }
    )
    detail = {
        "file_sizes": files,
        "method_metrics": methods,
        "code_duplication": {"code_duplication_1": fragments_a, "code_duplication_2": fragments_b}
        if group_size
        else {},
        "duplication_files": {"duplication_file_1": whole_members} if whole_members else {},
        "unsafe_functions": unsafe,
        "redundant_code": redundant,
        "huge_folders": {p: n for p, n in directory_items.items() if n > THRESHOLDS["huge_folder"]},
    }
    return {"summary_metrics": _summarize(detail, len(directory_items)), "detail_metrics": detail}


def scale_manifest(
    baseline: dict[str, Any], current: dict[str, Any], **config: Any
) -> dict[str, Any]:
    """轻量配置及对象级计数，不复制报告、函数全集或逐对象变化台账。"""
    before = baseline["detail_metrics"]["file_sizes"]
    after = current["detail_metrics"]["file_sizes"]
    shared = sum(p in after for p in before)
    modified = sum(p in after and value != after[p] for p, value in before.items())
    return {
        "root": ROOT,
        "config": config,
        "baseline": baseline["summary_metrics"],
        "current": current["summary_metrics"],
        "sharedFiles": shared,
        "unionFiles": len(before) + len(after) - shared,
        "addedFiles": len(after) - shared,
        "removedFiles": len(before) - shared,
        "modifiedSharedFiles": modified,
        "overlapRatio": safe_div(shared, len(before) + len(after) - shared),
        "retainedBaselineRatio": safe_div(shared, len(before)),
        "changedBaselineRatio": safe_div(len(before) - shared + modified, len(before)),
        "validation": "紧凑规则合成；不提供逐有效行模型，不声明全量 L3 通过",
        "coverageRule": "有效行 range(1,2*n,2)；片段覆盖 [10,50) ∪ [30,70) = 60；整文件覆盖 n",
    }


def main() -> None:
    """独立可复现生成命令，分块写 JSON，保留性能及轻量 meta。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--num-files", type=int, default=100_000)
    parser.add_argument("--seed", type=int, default=20261021)
    parser.add_argument("--change-rate", type=float, default=1.0)
    parser.add_argument("--shape", choices=["wide", "deep", "mixed"], default="mixed")
    parser.add_argument("--churn-rate", type=float, default=0.02)
    parser.add_argument("--duplicate-group-size", type=int, default=10_000)
    parser.add_argument("--ambiguity-rate", type=float, default=0.2)
    parser.add_argument("--short-names", action="store_true")
    parser.add_argument("--output-dir", type=Path, default=Path("output/prototype-scale-data"))
    parser.add_argument("--validate", choices=["L2", "L1L2"], help="执行现有校验器；L1 大规模较慢")
    args = parser.parse_args()
    config = {
        k: v for k, v in vars(args).items() if k not in {"output_dir", "short_names", "validate"}
    }
    config["long_names"] = not args.short_names
    started = time.perf_counter()
    generated = 0.0
    args.output_dir.mkdir(parents=True, exist_ok=True)
    baseline: dict[str, Any] = {}
    manifest: dict[str, Any] = {}
    for side in ("baseline", "current"):
        side_started = time.perf_counter()
        report = generate_scale_side(**config, current=side == "current")
        generated += time.perf_counter() - side_started
        if args.validate:
            from cmetrics_cmp_viz.validator import validate_l1, validate_l2

            if args.validate == "L1L2":
                errors = validate_l1(report)
                if errors:
                    raise ValueError(errors[:10])
            errors = validate_l2(report)
            if errors:
                raise ValueError(errors[:10])
        with (args.output_dir / f"{side}.json").open("w", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, separators=(",", ":"))
        if side == "baseline":
            baseline = {
                "detail_metrics": {"file_sizes": report["detail_metrics"]["file_sizes"]},
                "summary_metrics": report["summary_metrics"],
            }
        else:
            manifest = scale_manifest(baseline, report, **config)
        del report
    del baseline
    if args.validate:
        manifest["checksPassed"] = args.validate
    manifest["measurement"] = {
        "generationSeconds": round(generated, 3),
        "totalSecondsIncludingValidationAndWrite": round(time.perf_counter() - started, 3),
        "peakRssMiB": round(peak_rss_mib(), 3),
        "python": sys.version,
    }
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps({"output": str(args.output_dir), **manifest["measurement"]}, ensure_ascii=False)
    )


if __name__ == "__main__":
    main()
