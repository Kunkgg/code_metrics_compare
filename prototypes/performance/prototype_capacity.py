"""大数据容量验证原型构建器：读取两侧扫描 JSON，产出紧凑分块的单 HTML。

一次性验证入口，不是正式报告生成器：数据按块 gzip+base64 内嵌，
浏览器内由 Blob Worker 解压、建索引并执行查询。二进制分块为本机小端格式。
"""

import argparse
import base64
import gc
import gzip
import html
import itertools
import json
import shlex
import struct
import time
from array import array
from collections import Counter
from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

from cmetrics_cmp_viz.schema import is_header_file
from prototypes.resource_usage import peak_rss_mib
from prototypes.ui.prototype import (
    MAIN_METRICS,
    THRESHOLD_KEYS,
    display_number,
    load_metric_names,
    safe_json,
    threshold_comparison,
)

BLOCK_ORDER = [
    "meta",
    "paths",
    "files",
    "names",
    "dirs",
    "methodsB",
    "methodsC",
    "fragB",
    "fragC",
    "dupfilesB",
    "dupfilesC",
    "unsafeB",
    "unsafeC",
    "redundantB",
    "redundantC",
]


def gzip_b64(payload: bytes) -> str:
    return base64.b64encode(gzip.compress(payload, 9)).decode("ascii")


def text_block(text: str) -> str:
    return gzip_b64(text.encode("utf-8"))


def json_block(value: Any) -> str:
    return text_block(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


DTYPES = {"u32": "I", "i32": "i", "u8": "B"}


def bin_block(arrays: list[tuple[str, str, Any]]) -> str:
    """按 Worker parseBin 约定打包：u32 头长 + JSON 头 + 4 字节对齐负载。"""
    header: dict[str, Any] = {"a": {}, "n": len(arrays[0][2])}
    payload = bytearray()
    for name, dtype, seq in arrays:
        offset = len(payload)
        if dtype != "u8":
            offset += (-offset) % 4
            payload.extend(b"\0" * (offset - len(payload)))
        header["a"][name] = {"t": dtype, "o": offset, "n": len(seq)}
        payload.extend(array(DTYPES[dtype], seq).tobytes() if len(seq) else b"")
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    out = bytearray(struct.pack("<I", len(header_bytes)))
    out.extend(header_bytes)
    out.extend(b"\0" * ((-(4 + len(header_bytes))) % 4))
    out.extend(payload)
    return gzip_b64(bytes(out))


def rel_path(path: str, root: str) -> str:
    if path == root:
        return ""
    prefix = f"{root}/"
    if not path.startswith(prefix):
        raise ValueError(f"路径不在扫描根下：{path}")
    return path[len(prefix) :]


class SideData:
    """从一侧扫描 JSON 抽取的紧凑结构（fileId 在抽取时即映射为并集索引）。"""

    def __init__(
        self, report: dict[str, Any], root: str, file_id: dict[str, int], name_id: dict[str, int]
    ) -> None:
        detail = report["detail_metrics"]
        self.summary = report["summary_metrics"]
        self.maxima = detail["method_metrics"][-1]
        self.files = detail["file_sizes"]
        self.methods: list[tuple[int, int, int, int, int | None, int | None]] = []
        for m in detail["method_metrics"][:-1]:
            self.methods.append(
                (
                    file_id[rel_path(m["file_name"], root)],
                    name_id[m["method_name"]],
                    m["start_line"],
                    m["end_line"],
                    m["nbnc_loc"],
                    m["cyclomatic_complexity"],
                )
            )
        self.frag_groups: list[tuple[str, list[tuple[int, int, int]]]] = []
        for group_id, fragments in detail["code_duplication"].items():
            self.frag_groups.append(
                (
                    group_id,
                    [
                        (
                            file_id[rel_path(f["file_name"], root)],
                            f["start_line"],
                            f["code_duplication"],
                        )
                        for f in fragments
                    ],
                )
            )
        self.dupfiles = [
            (group_id, [file_id[rel_path(p, root)] for p in members])
            for group_id, members in detail["file_duplication"].items()
        ]
        self.unsafe: list[tuple[int, int, int]] = []
        for path, names in detail["unsafe_functions"].items():
            f = file_id[rel_path(path, root)]
            for name, lines in names.items():
                for line in lines:
                    self.unsafe.append((f, name_id[name], line))
        self.unsafe.sort()
        self.redundant: list[tuple[int, int]] = []
        for path, lines in detail["redundant_code"].items():
            f = file_id[rel_path(path, root)]
            self.redundant.extend((f, line) for line in lines)
        self.redundant.sort()
        self.huge_folders = {rel_path(p, root): n for p, n in detail["huge_folders"].items()}
        self.directory_members = directory_member_counts(rel_path(p, root) for p in self.files)


def directory_member_counts(paths: Iterable[str]) -> dict[str, int]:
    """从扫描可见路径恢复直接成员；子目录去重，不把后代文件重复计入。"""
    members: dict[str, set[str]] = {}
    for path in paths:
        parts = path.split("/")
        for i in range(len(parts)):
            parent = "/".join(parts[:i])
            members.setdefault(parent, set()).add(parts[i])
    return {path: len(children) for path, children in members.items()}


def compact_threshold_transitions(
    baseline: SideData, current: SideData
) -> tuple[dict[str, Any], int]:
    """保留已知对象的进出；未知、重名或目录覆盖不足的对象不参与确定计数。"""
    ambiguous: set[tuple[int, int]] = set()
    for data in (baseline, current):
        counts = Counter((m[0], m[1]) for m in data.methods)
        ambiguous.update(key for key, count in counts.items() if count > 1)
    del counts
    kinds = ("hugeHeader", "hugeSource", "hugeMethod", "hugeCC", "folders")
    excluded: dict[str, set[Any]] = {kind: set() for kind in kinds}

    def objects(data: SideData) -> dict[str, set[Any]]:
        thresholds = data.summary["huge_threshold"]
        result: dict[str, set[Any]] = {kind: set() for kind in kinds}
        for path, values in data.files.items():
            kind = "hugeHeader" if is_header_file(path) else "hugeSource"
            threshold = "huge_headerfile" if kind == "hugeHeader" else "huge_non_headerfile"
            if values[0] is None or thresholds[threshold] is None:
                excluded[kind].add(path)
            elif values[0] > thresholds[threshold]:
                result[kind].add(path)
        for method in data.methods:
            key = (method[0], method[1])
            for kind, index, threshold in (
                ("hugeMethod", 4, "huge_method"),
                ("hugeCC", 5, "huge_cyclomatic_complexity"),
            ):
                value = method[index]
                if value is None or thresholds[threshold] is None:
                    excluded[kind].add(key)
                elif value > thresholds[threshold]:
                    if key in ambiguous:
                        excluded[kind].add(key)
                    else:
                        result[kind].add(key)
        return result

    before, after = objects(baseline), objects(current)
    # 两侧任一申报的目录才进入超大目录任务；未申报侧仍可恢复可见成员。
    for data, result in ((baseline, before), (current, after)):
        members = getattr(data, "directory_members", None)
        if members is None:
            members = directory_member_counts(data.files)
        for path in baseline.huge_folders.keys() | current.huge_folders.keys():
            recovered = members.get(path, 0)
            declared = data.huge_folders.get(path)
            if data.summary["huge_threshold"]["huge_folder"] is None or (
                declared is not None and declared != recovered
            ):
                excluded["folders"].add(path)
            elif recovered > data.summary["huge_threshold"]["huge_folder"]:
                result["folders"].add(path)
    return {
        kind: {
            "entered": len(after[kind] - before[kind] - excluded[kind]),
            "exited": len(before[kind] - after[kind] - excluded[kind]),
            "limited": bool(excluded[kind])
            or any(
                data.summary["huge_threshold"][THRESHOLD_KEYS[kind]] is None
                for data in (baseline, current)
            ),
            **threshold_comparison(baseline.summary, current.summary, kind),
            **(
                {
                    "thresholdChanged": False,
                    "warning": "超限阈值未知；无法确定清单进出及净影响。",
                }
                if any(
                    data.summary["huge_threshold"][THRESHOLD_KEYS[kind]] is None
                    for data in (baseline, current)
                )
                else {}
            ),
        }
        for kind in kinds
    }, len(ambiguous)


def build_dirs(
    paths: list[str], baseline: SideData, current: SideData, root: str
) -> list[dict[str, Any]]:
    """并集目录树：每目录两侧文件数／代码量、直接子目录与直属文件、申报超大计数。"""
    dirs: dict[str, dict[str, Any]] = {
        "": {"p": "", "par": None, "dep": 0, "cf": [], "cd": [], "bF": 0, "cF": 0, "bC": 0, "cC": 0}
    }
    for f, path in enumerate(paths):
        parts = path.split("/")
        parent = ""
        for i in range(1, len(parts)):
            d = "/".join(parts[:i])
            if d not in dirs:
                dirs[d] = {
                    "p": d,
                    "par": parent,
                    "dep": i,
                    "cf": [],
                    "cd": [],
                    "bF": 0,
                    "cF": 0,
                    "bC": 0,
                    "cC": 0,
                }
                dirs[parent]["cd"].append(d)
            parent = d
        dirs[parent]["cf"].append(f)
    for side, data in (("b", baseline), ("c", current)):
        for path, triple in data.files.items():
            rel = rel_path(path, root)
            value = triple[0]
            d = rel.rsplit("/", 1)[0] if "/" in rel else ""
            while True:
                dirs[d][f"{side}F"] += 1
                total = dirs[d][f"{side}C"]
                dirs[d][f"{side}C"] = None if total is None or value is None else total + value
                if not d:
                    break
                d = dirs[d]["par"]
    ordered = sorted(dirs.values(), key=lambda d: d["p"])
    index = {d["p"]: i for i, d in enumerate(ordered)}
    for d in ordered:
        d["par"] = index[d["par"]] if d["par"] is not None else None
        d["cd"] = sorted(index[c] for c in d["cd"])
        d["cf"] = sorted(d["cf"])
    for data in (baseline, current):
        for p in data.huge_folders:
            if p not in index:
                raise ValueError(f"超大目录不在并集目录树中：{p}")
    for d in ordered:
        d["kB"] = baseline.huge_folders.get(d["p"])
        d["kC"] = current.huge_folders.get(d["p"])
    return ordered


def compact_integrity(
    baseline: SideData, current: SideData, dirs: list[dict[str, Any]], root: str
) -> dict[str, Any]:
    """保留扫描原始汇总，另外提供可消费的未知、复算冲突及比较范围限制。"""
    issues: dict[str, list[str]] = {}
    comparison: list[str] = []

    def add(keys: Iterable[str], reason: str) -> None:
        for key in keys:
            if reason not in issues.setdefault(key, []):
                issues[key].append(reason)

    # 基础量异常同时影响其依赖指标；不把未确认的汇总替换为明细小计。
    dependencies = {
        "code_size": [
            "lines_per_file",
            "code_duplication_ratio",
            "non_hfile_code_duplication_ratio",
            "unsafe_functions_kloc",
            "redundant_code_kloc",
        ],
        "code_duplication_total": ["code_duplication_ratio"],
        "non_hfile_code_duplication_total": ["non_hfile_code_duplication_ratio"],
        "method_lines": ["lines_per_method"],
        "cyclomatic_complexity_total": ["cyclomatic_complexity_per_method"],
        "files_total": [
            "lines_per_file",
            "huge_headerfile_ratio",
            "huge_non_headerfile_ratio",
            "file_duplication_ratio",
            "non_hfile_duplication_ratio",
        ],
        "methods_total": [
            "lines_per_method",
            "cyclomatic_complexity_per_method",
            "huge_method_ratio",
            "huge_cyclomatic_complexity_ratio",
        ],
        "folders_total": ["huge_folder_ratio"],
        "huge_headerfile_total": ["huge_headerfile_ratio"],
        "huge_non_headerfile_total": ["huge_non_headerfile_ratio"],
        "huge_method_total": ["huge_method_ratio"],
        "huge_cyclomatic_complexity_total": ["huge_cyclomatic_complexity_ratio"],
        "huge_folder_total": ["huge_folder_ratio"],
    }

    def affected(key: str) -> list[str]:
        return [key, *dependencies.get(key, [])]

    for label, tag, data in (("基线", "b", baseline), ("当前", "c", current)):
        summary = data.summary
        totals: dict[str, int] = dict.fromkeys(
            (
                "code_size",
                "raw_lines",
                "code_duplication_total",
                "non_hfile_code_duplication_total",
                "method_lines",
                "cyclomatic_complexity_total",
                "huge_headerfile_total",
                "huge_non_headerfile_total",
                "huge_method_total",
                "huge_cyclomatic_complexity_total",
            ),
            0,
        )
        unknown: set[str] = set()
        unknown_thresholds = {
            threshold + "_total"
            for threshold in THRESHOLD_KEYS.values()
            if summary["huge_threshold"][threshold] is None
        }
        for key in sorted(unknown_thresholds):
            unknown.add(key)
            add(affected(key), f"{label}超限阈值未知，无法复算 {key} 或确定清单进出及净影响。")
        for path, values in data.files.items():
            for index, key in ((0, "code_size"), (1, "raw_lines"), (2, "code_duplication_total")):
                if values[index] is None:
                    unknown.add(key)
                else:
                    totals[key] += values[index]
            header = is_header_file(path)
            if not header:
                if values[2] is None:
                    unknown.add("non_hfile_code_duplication_total")
                else:
                    totals["non_hfile_code_duplication_total"] += values[2]
            key = "huge_headerfile_total" if header else "huge_non_headerfile_total"
            limit = summary["huge_threshold"][
                "huge_headerfile" if header else "huge_non_headerfile"
            ]
            if values[0] is None or limit is None:
                unknown.add(key)
            else:
                totals[key] += int(values[0] > limit)
        for method in data.methods:
            for index, key, huge, threshold in (
                (4, "method_lines", "huge_method_total", "huge_method"),
                (
                    5,
                    "cyclomatic_complexity_total",
                    "huge_cyclomatic_complexity_total",
                    "huge_cyclomatic_complexity",
                ),
            ):
                value = method[index]
                if value is None:
                    unknown.update((key, huge))
                else:
                    totals[key] += value
                    if summary["huge_threshold"][threshold] is not None:
                        totals[huge] += int(value > summary["huge_threshold"][threshold])
        totals.update(
            files_total=len(data.files),
            methods_total=len(data.methods),
            folders_total=sum(d[f"{tag}F"] > 0 for d in dirs),
        )
        huge_folders = 0
        for directory in dirs:
            recovered = data.directory_members.get(directory["p"], 0)
            declared = directory["kB" if tag == "b" else "kC"]
            limit = summary["huge_threshold"]["huge_folder"]
            over = limit is not None and recovered > limit
            huge_folders += int(over)
            if (declared is not None and declared != recovered) or (declared is None and over):
                add(
                    affected("huge_folder_total"),
                    f"{label}目录 {directory['p'] or '/'} 的申报超大目录与扫描可见直接成员覆盖不一致。",
                )
        totals["huge_folder_total"] = huge_folders
        for key in sorted(unknown - unknown_thresholds):
            add(affected(key), f"{label}明细含未知值，无法完整复算 {key}。")
        for key, expected in totals.items():
            if key not in unknown and summary.get(key) != expected:
                add(
                    affected(key),
                    f"{label}汇总 {key} 与明细复算不一致（汇总 {summary.get(key)}，明细 {expected}）。",
                )
        for key, numerator, denominator, scale in (
            ("lines_per_file", "code_size", "files_total", 1),
            ("lines_per_method", "method_lines", "methods_total", 1),
            ("cyclomatic_complexity_per_method", "cyclomatic_complexity_total", "methods_total", 1),
            ("code_duplication_ratio", "code_duplication_total", "code_size", 100),
            (
                "non_hfile_code_duplication_ratio",
                "non_hfile_code_duplication_total",
                "code_size",
                100,
            ),
            ("huge_headerfile_ratio", "huge_headerfile_total", "files_total", 100),
            ("huge_non_headerfile_ratio", "huge_non_headerfile_total", "files_total", 100),
            ("huge_method_ratio", "huge_method_total", "methods_total", 100),
            (
                "huge_cyclomatic_complexity_ratio",
                "huge_cyclomatic_complexity_total",
                "methods_total",
                100,
            ),
            ("huge_folder_ratio", "huge_folder_total", "folders_total", 100),
        ):
            if numerator in unknown or denominator in unknown or not totals[denominator]:
                continue
            expected = (Decimal(totals[numerator]) * scale / Decimal(totals[denominator])).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            actual = summary.get(key)
            if (
                actual is None
                or Decimal(str(actual)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                != expected
            ):
                add(
                    [key],
                    f"{label}汇总 {key} 与明细按两位小数复算不一致（汇总 {actual}，明细 {expected}）。",
                )
        try:
            command = shlex.split(summary.get("command", ""))
            scan_root = command[command.index("-fp") + 1]
        except (ValueError, IndexError):
            comparison.append(
                f"{label} command 未提供可识别的 -fp 扫描根，无法确认 manifest.root 的路径映射。"
            )
        else:
            if scan_root.rstrip("/") != root.rstrip("/"):
                comparison.append(
                    f"{label} command 的扫描根 {scan_root} 与 manifest.root {root} 不一致，路径映射尚未确认。"
                )
    b_version, c_version = (
        baseline.summary.get("cmetrics_version"),
        current.summary.get("cmetrics_version"),
    )
    if not b_version or not c_version or b_version != c_version:
        comparison.append(
            f"两侧 cmetrics_version 不同或缺失（基线 {b_version}，当前 {c_version}），度量口径可比性尚未确认。"
        )
    return {"summaryIssues": issues, "comparisonIssues": comparison}


def static_overview(meta: dict[str, Any]) -> str:
    rows = []
    for key, unit, _group in meta["mainMetrics"]:
        name = meta["metricNames"].get(key, key)
        b = meta["summaries"]["baseline"][key]
        c = meta["summaries"]["current"][key]
        decimal = key.endswith(("_ratio", "_kloc", "_per_file", "_per_method"))
        delta = c - b
        warning = ""
        for kind, threshold_key in THRESHOLD_KEYS.items():
            if key in (threshold_key + "_total", threshold_key + "_ratio"):
                transition = meta["thresholdTransitions"][kind]
                if transition.get("warning"):
                    warning = f'<p class="notice">{html.escape(transition["warning"])}</p>'
        rows.append(
            f"<tr><td>{html.escape(name)}{warning}</td><td>{display_number(b, decimal=decimal)}</td>"
            f"<td>{display_number(c, decimal=decimal)}</td>"
            f"<td>{display_number(delta, decimal=decimal, delta=True)}</td><td>{html.escape(unit)}</td></tr>"
        )
    return (
        '<section class="panel"><h2>静态概览 / 模拟数据</h2>'
        "<p>若交互未启动，仅可阅读此处；目录导航、搜索与下钻不可用。</p>"
        "<table><thead><tr><th>指标</th><th>基线</th><th>当前</th><th>变化</th><th>单位</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table></section>"
    )


def build_payload(input_dir: Path) -> tuple[dict[str, Any], dict[str, str]]:
    """逐侧读取扫描报告，生成可供不同原型页面复用的元数据与紧凑块。"""
    manifest = json.loads((input_dir / "manifest.json").read_text(encoding="utf-8"))
    root = manifest["root"]

    # 先读两侧文件路径并集与名字并集，再逐侧抽取，避免两份完整报告同时驻留。
    side_paths: dict[str, dict[str, list[int | None]]] = {}
    all_names: set[str] = set()
    for side in ("baseline", "current"):
        report = json.loads((input_dir / f"{side}.json").read_text(encoding="utf-8"))
        side_paths[side] = report["detail_metrics"]["file_sizes"]
        for m in report["detail_metrics"]["method_metrics"][:-1]:
            all_names.add(m["method_name"])
        for names in report["detail_metrics"]["unsafe_functions"].values():
            all_names.update(names)
        del report
        gc.collect()
    union = sorted(set(side_paths["baseline"]) | set(side_paths["current"]))
    paths = [rel_path(p, root) for p in union]
    file_id = {p: i for i, p in enumerate(paths)}
    names = sorted(all_names)
    name_id = {n: i for i, n in enumerate(names)}
    print(f"并集文件 {len(paths):,}，名字字典 {len(names):,}")

    sides: dict[str, SideData] = {}
    for side in ("baseline", "current"):
        report = json.loads((input_dir / f"{side}.json").read_text(encoding="utf-8"))
        sides[side] = SideData(report, root, file_id, name_id)
        del report
        gc.collect()
    baseline, current = sides["baseline"], sides["current"]
    dirs = build_dirs(paths, baseline, current, root)

    for label, flag, side in (("基线", "b", baseline), ("当前", "c", current)):
        fis = [m[0] for m in side.methods]
        if any(a > b for a, b in itertools.pairwise(fis)):
            side.methods.sort(key=lambda method: method[:4])
        folder_count = sum(1 for d in dirs if d["p"] and d[f"{flag}F"] > 0)
        print(f"{label}函数 {len(side.methods):,}，目录 {folder_count:,}")

    transitions, ambiguous_count = compact_threshold_transitions(baseline, current)
    meta = {
        "scale": {**manifest["config"], "unionFiles": manifest["unionFiles"]},
        "root": root,
        "maxima": {"baseline": baseline.maxima, "current": current.maxima},
        "thresholdTransitions": transitions,
        "integrity": compact_integrity(baseline, current, dirs, root),
        "ambiguousMethodCount": ambiguous_count,
        "dictionaryEncoding": "json",
        "directoryCount": len(dirs),
        "metricNames": load_metric_names(),
        "summaries": {"baseline": baseline.summary, "current": current.summary},
        "manifest": manifest,
        "mainMetrics": [
            [key, unit, "超大指标" if key.startswith("huge_") else "常规指标"]
            for key, unit in MAIN_METRICS
        ],
        "groups": {
            "baseline": [gid for gid, _ in baseline.frag_groups],
            "current": [gid for gid, _ in current.frag_groups],
        },
        "pageSize": 50,
    }

    blocks: dict[str, str] = {
        "meta": json_block(meta),
        "paths": json_block(paths),
        "names": json_block(names),
        "dirs": json_block(dirs),
    }
    rel_files = {
        tag: {rel_path(p, root): v for p, v in sides[side].files.items()}
        for tag, side in (("b", "baseline"), ("c", "current"))
    }

    def col(mapping: dict[str, list[int | None]], index: int) -> list[int]:
        # 二进制数值列必须为整数；占位值的业务有效性由独立位图决定。
        return [mapping[p][index] or 0 if p in mapping else 0 for p in paths]

    def valid(mapping: dict[str, list[int | None]]) -> list[int]:
        return [
            sum(1 << i for i, value in enumerate(mapping[p]) if value is not None)
            if p in mapping
            else 0
            for p in paths
        ]

    blocks["files"] = bin_block(
        [
            ("bEx", "u8", [1 if p in rel_files["b"] else 0 for p in paths]),
            ("cEx", "u8", [1 if p in rel_files["c"] else 0 for p in paths]),
            ("bValid", "u8", valid(rel_files["b"])),
            ("cValid", "u8", valid(rel_files["c"])),
            ("bN", "i32", col(rel_files["b"], 0)),
            ("cN", "i32", col(rel_files["c"], 0)),
            ("bR", "i32", col(rel_files["b"], 1)),
            ("cR", "i32", col(rel_files["c"], 1)),
            ("bD", "i32", col(rel_files["b"], 2)),
            ("cD", "i32", col(rel_files["c"], 2)),
        ]
    )
    for tag, side in (("B", "baseline"), ("C", "current")):
        data = sides[side]
        blocks[f"methods{tag}"] = bin_block(
            [
                ("fi", "u32", [m[0] for m in data.methods]),
                ("na", "u32", [m[1] for m in data.methods]),
                ("st", "u32", [m[2] for m in data.methods]),
                ("en", "u32", [m[3] for m in data.methods]),
                ("ln", "u32", [m[4] or 0 for m in data.methods]),
                ("cc", "u32", [m[5] or 0 for m in data.methods]),
                (
                    "valid",
                    "u8",
                    [int(m[4] is not None) | (int(m[5] is not None) << 1) for m in data.methods],
                ),
            ]
        )
        frag_flat = [(g, fr) for g, (_, frags) in enumerate(data.frag_groups) for fr in frags]
        blocks[f"frag{tag}"] = bin_block(
            [
                ("g", "u32", [g for g, _ in frag_flat]),
                ("f", "u32", [fr[0] for _, fr in frag_flat]),
                ("s", "u32", [fr[1] for _, fr in frag_flat]),
                ("l", "u32", [fr[2] for _, fr in frag_flat]),
            ]
        )
        blocks[f"dupfiles{tag}"] = json_block(
            [{"id": gid, "m": members} for gid, members in data.dupfiles]
        )
        blocks[f"unsafe{tag}"] = bin_block(
            [
                ("f", "u32", [r[0] for r in data.unsafe]),
                ("na", "u32", [r[1] for r in data.unsafe]),
                ("ln", "u32", [r[2] for r in data.unsafe]),
            ]
        )
        blocks[f"redundant{tag}"] = bin_block(
            [
                ("f", "u32", [r[0] for r in data.redundant]),
                ("ln", "u32", [r[1] for r in data.redundant]),
            ]
        )
    del sides, side_paths, rel_files
    gc.collect()

    return meta, blocks


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=Path("output/scale-100k-full"))
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    started = time.perf_counter()
    meta, blocks = build_payload(args.input_dir)

    template_dir = Path(__file__).parent
    template = (template_dir / "large.html").read_text(encoding="utf-8")
    worker_src = (template_dir / "large_worker.js").read_text(encoding="utf-8")
    script_src = (template_dir / "large.js").read_text(encoding="utf-8")
    for name, src in (("worker", worker_src), ("script", script_src)):
        if "</script" in src:
            raise ValueError(f"{name} 源码包含 script 结束标记，拒绝注入")
    blocks_html = "\n".join(
        f'<script type="application/octet-stream" data-block-kind="{kind}">{blocks[kind]}</script>'
        for kind in BLOCK_ORDER
    )
    replacements = {
        "@@STYLE@@": (template_dir.parent / "ui" / "prototype.css").read_text(encoding="utf-8")
        + "\n"
        + (template_dir / "large.css").read_text(encoding="utf-8"),
        "@@STATIC@@": static_overview(meta),
        "@@META@@": safe_json(meta),
        "@@WORKER@@": worker_src,
        "@@BLOCKS@@": blocks_html,
        "@@SCRIPT@@": script_src,
    }
    for marker, value in replacements.items():
        template = template.replace(marker, value)
    output = args.output or (args.input_dir / "capacity-report.html")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(template, encoding="utf-8")
    temporary.replace(output)
    elapsed = time.perf_counter() - started
    rss = peak_rss_mib()
    sizes = {kind: len(blocks[kind]) for kind in BLOCK_ORDER}
    print(
        json.dumps(
            {
                "output": str(output),
                "htmlBytes": output.stat().st_size,
                "buildSeconds": round(elapsed, 2),
                "peakRssMiB": round(rss, 1),
                "blocks": sizes,
                "files": meta["scale"]["unionFiles"],
                "dirs": meta["directoryCount"],
            },
            ensure_ascii=False,
        )
    )
    if args.open:
        import webbrowser

        webbrowser.open(output.resolve().as_uri())


if __name__ == "__main__":
    main()
