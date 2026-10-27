"""一次性 UI 原型的受控合成模型；不是正式扫描适配器。"""

import random
from pathlib import PurePosixPath
from typing import Any

from cmetrics_cmp_viz.schema import is_header_file, safe_div

ROOT = "/workspace/project"
THRESHOLDS = {
    "huge_headerfile": 500,
    "huge_non_headerfile": 2000,
    "huge_method": 50,
    "huge_cyclomatic_complexity": 20,
    "huge_folder": 50,
}
STORY_PATHS = {
    "parser": f"{ROOT}/src/core/parser.c",
    "utilsGrow": f"{ROOT}/src/utils/grow.c",
    "utilsShrink": f"{ROOT}/src/utils/shrink.c",
    "shared": f"{ROOT}/src/core/shared.c",
    "bulk": f"{ROOT}/src/bulk",
    "folderEntered": f"{ROOT}/src/expanded",
    "folderExited": f"{ROOT}/src/trimmed",
}


def summarize(detail: dict[str, Any], directory_count: int) -> dict[str, Any]:
    """只从已完成的明细派生 33 项汇总，不预设期望总量。"""
    files = detail["file_sizes"]
    methods = detail["method_metrics"][:-1]
    sources = [p for p in files if not is_header_file(p)]
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


def generate_side(seed: int, current: bool) -> tuple[dict[str, Any], dict[str, Any]]:
    """每个有效行对应奇数物理行，使有效长度与物理跨度明确不同。"""
    rng = random.Random(seed)
    counts = {
        "src/core/parser.c": 2160 if current else 1880,
        "src/core/shared.c": 320,
        "src/core/legacy.c": 1900 if current else 2120,
        "src/utils/grow.c": 390 if current else 300,
        "src/utils/shrink.c": 210 if current else 300,
        "include/api.h": 540 if current else 480,
        "include/legacy.h": 480 if current else 540,
    }
    counts.update({f"src/bulk/unit_{i:02}.c": rng.randint(180, 360) for i in range(49)})
    counts.update(
        {
            f"src/{area}/module_{i:02}.c": rng.randint(180, 360)
            for area in ("net", "driver", "codec", "storage")
            for i in range(5)
        }
    )
    counts["src/bulk/nested/leaf.c"] = 200
    # 两侧使用相同次数、相同顺序的随机调用；新增退出成员采用固定大小。
    for i in range(2):
        counts[f"src/bulk/{'added' if current else 'retired'}_{i:02}.c"] = 220
    for area in ("expanded", "trimmed"):
        counts.update({f"src/{area}/unit_{i:02}.c": 220 for i in range(50)})
        if (area == "expanded") == current:
            counts.update({f"src/{area}/extra_{i:02}.c": 220 for i in range(2)})
    models: dict[str, Any] = {}
    methods = []
    for relative, count in sorted(counts.items()):
        path = f"{ROOT}/{relative}"
        models[path] = {
            "raw_lines": count * 2 + 20,
            "valid_lines": list(range(1, count * 2, 2)),
            "dup_lines_union": [],
        }
        names = ["init", "process", "cleanup"]
        lengths = [30, 45, 20]
        complexities = [4, 12, 3]
        if relative == "src/core/parser.c":
            names = ["parse", "parse", "func_worker", "func_worker", "parse_token"]
            lengths = [30, 35, 25, 28, 85 if current else 45]
            complexities = [7, 9, 6, 8, 28 if current else 18]
        elif relative == "src/core/legacy.c":
            lengths[1] = 45 if current else 65
            complexities[1] = 18 if current else 26
        offset = 5
        for name, length, cc in zip(names, lengths, complexities, strict=True):
            methods.append(
                {
                    "file_name": path,
                    "method_name": name,
                    "nbnc_loc": length,
                    "cyclomatic_complexity": cc,
                    "start_line": offset * 2 + 1,
                    "end_line": (offset + length - 1) * 2 + 1,
                }
            )
            offset += length + 5
    parser, shared = STORY_PATHS["parser"], STORY_PATHS["shared"]
    # shared 的重复覆盖保持 40 行，parser 首组由 20 增至 40；组号仅在各扫描内有意义。
    groups = {
        "code_duplication_91" if current else "code_duplication_1": [
            {
                "file_name": parser,
                "start_line": 41 if current else 21,
                "code_duplication": 40 if current else 20,
            },
            {"file_name": shared, "start_line": 21, "code_duplication": 40 if current else 20},
        ]
    }
    if not current:
        groups["code_duplication_2"] = [
            {"file_name": shared, "start_line": 21, "code_duplication": 20},
            {"file_name": shared, "start_line": 61, "code_duplication": 20},
        ]
    # parser 关联两个独立组，每组有不同关联文件；不由有效长度推算物理结束行。
    groups["code_duplication_107" if current else "code_duplication_7"] = [
        {"file_name": parser, "start_line": 201, "code_duplication": 30 if current else 20},
        {
            "file_name": STORY_PATHS["utilsGrow" if current else "utilsShrink"],
            "start_line": 101,
            "code_duplication": 30 if current else 20,
        },
    ]
    dup_files = {
        "41" if current else "3": [f"{ROOT}/src/codec/module_00.c", f"{ROOT}/src/codec/module_01.c"]
    }
    if current:
        dup_files["41"].append(f"{ROOT}/src/codec/module_02.c")
    for path, model in models.items():
        covered: set[int] = set()
        for fragments in groups.values():
            for fragment in fragments:
                if fragment["file_name"] == path:
                    start = model["valid_lines"].index(fragment["start_line"])
                    covered.update(
                        model["valid_lines"][start : start + fragment["code_duplication"]]
                    )
        if any(path in members for members in dup_files.values()):
            covered.update(model["valid_lines"])
        model["dup_lines_union"] = sorted(covered)
    children: dict[str, set[str]] = {}
    for path in models:
        child = PurePosixPath(path)
        while str(child) != ROOT:
            parent = child.parent
            children.setdefault(str(parent), set()).add(str(child))
            child = parent
    methods.append(
        {
            "maximum_cyclomatic_complexity": max(m["cyclomatic_complexity"] for m in methods),
            "maximum_nbnc_loc": max(m["nbnc_loc"] for m in methods),
        }
    )
    detail = {
        "file_sizes": {
            p: [len(m["valid_lines"]), m["raw_lines"], len(m["dup_lines_union"])]
            for p, m in models.items()
        },
        "method_metrics": methods,
        "code_duplication": groups,
        "duplication_files": dup_files,
        "unsafe_functions": {
            parser: {"strcpy": [151 if current else 121, 211], "sprintf": [211]},
            shared: {"gets": [81]},
        },
        "redundant_code": {parser: [302 if current else 282, 402], shared: [202]},
        "huge_folders": {
            p: len(items)
            for p, items in sorted(children.items())
            if len(items) > THRESHOLDS["huge_folder"]
        },
    }
    return {"summary_metrics": summarize(detail, len(children)), "detail_metrics": detail}, {
        "file_models": models
    }


def make_ledger(baseline: dict[str, Any], current: dict[str, Any]) -> list[dict[str, Any]]:
    """逐容器记录原始变化；函数按文件保留整组，不猜测同名配对。"""
    ledger = []
    for field in baseline["detail_metrics"]:
        before = baseline["detail_metrics"][field]
        after = current["detail_metrics"][field]
        if field == "method_metrics":
            before = {
                p: [m for m in before[:-1] if m["file_name"] == p]
                for p in baseline["detail_metrics"]["file_sizes"]
            }
            after = {
                p: [m for m in after[:-1] if m["file_name"] == p]
                for p in current["detail_metrics"]["file_sizes"]
            }
        for target in sorted(before.keys() | after.keys()):
            old, new = before.get(target), after.get(target)
            if old != new:
                ledger.append(
                    {
                        "target": target,
                        "field": field,
                        "type": "added"
                        if old is None
                        else "removed"
                        if new is None
                        else "modified",
                        "old": old,
                        "new": new,
                    }
                )
    return ledger
