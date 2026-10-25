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
import resource
import struct
import sys
import time
from array import array
from pathlib import Path
from typing import Any

from cmetrics_cmp_viz.prototype import MAIN_METRICS, display_number, load_metric_names, safe_json

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
        self.files = detail["file_sizes"]
        self.methods: list[tuple[int, int, int, int, int, int]] = []
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
            for group_id, members in detail["duplication_files"].items()
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
                dirs[d][f"{side}C"] += value
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


def static_overview(meta: dict[str, Any]) -> str:
    rows = []
    for key, unit, _group in meta["mainMetrics"]:
        name = meta["metricNames"].get(key, key)
        b = meta["summaries"]["baseline"][key]
        c = meta["summaries"]["current"][key]
        decimal = key.endswith(("_ratio", "_kloc", "_per_file", "_per_method"))
        delta = c - b
        rows.append(
            f"<tr><td>{html.escape(name)}</td><td>{display_number(b, decimal=decimal)}</td>"
            f"<td>{display_number(c, decimal=decimal)}</td>"
            f"<td>{display_number(delta, decimal=decimal, delta=True)}</td><td>{html.escape(unit)}</td></tr>"
        )
    return (
        '<section class="panel"><h2>静态概览 / 模拟数据</h2>'
        "<p>若交互未启动，仅可阅读此处；目录导航、搜索与下钻不可用。</p>"
        "<table><thead><tr><th>指标</th><th>基线</th><th>当前</th><th>变化</th><th>单位</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table></section>"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=Path("output/scale-100k-full"))
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    started = time.perf_counter()
    manifest = json.loads((args.input_dir / "manifest.json").read_text(encoding="utf-8"))
    root = manifest["root"]

    # 先读两侧文件路径并集与名字并集，再逐侧抽取，避免两份完整报告同时驻留。
    side_paths: dict[str, dict[str, list[int]]] = {}
    all_names: set[str] = set()
    for side in ("baseline", "current"):
        report = json.loads((args.input_dir / f"{side}.json").read_text(encoding="utf-8"))
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
        report = json.loads((args.input_dir / f"{side}.json").read_text(encoding="utf-8"))
        sides[side] = SideData(report, root, file_id, name_id)
        del report
        gc.collect()
    baseline, current = sides["baseline"], sides["current"]
    dirs = build_dirs(paths, baseline, current, root)

    for label, flag, side in (("基线", "b", baseline), ("当前", "c", current)):
        fis = [m[0] for m in side.methods]
        if any(a > b for a, b in itertools.pairwise(fis)):
            side.methods.sort()
        folder_count = sum(1 for d in dirs if d["p"] and d[f"{flag}F"] > 0)
        print(f"{label}函数 {len(side.methods):,}，目录 {folder_count:,}")

    meta = {
        "scale": {**manifest["config"], "unionFiles": manifest["unionFiles"]},
        "root": root,
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
        "paths": text_block("\n".join(paths)),
        "names": text_block("\n".join(names)),
        "dirs": json_block(dirs),
    }
    f = len(paths)
    rel_files = {
        tag: {rel_path(p, root): v for p, v in sides[side].files.items()}
        for tag, side in (("b", "baseline"), ("c", "current"))
    }

    def col(mapping: dict[str, list[int]], index: int) -> list[int]:
        return [mapping[p][index] if p in mapping else 0 for p in paths]

    blocks["files"] = bin_block(
        [
            ("bEx", "u8", [1 if p in rel_files["b"] else 0 for p in paths]),
            ("cEx", "u8", [1 if p in rel_files["c"] else 0 for p in paths]),
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
                ("ln", "u32", [m[4] for m in data.methods]),
                ("cc", "u32", [m[5] for m in data.methods]),
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

    template_dir = Path(__file__).parent / "prototype_ui"
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
        "@@STYLE@@": (template_dir / "prototype.css").read_text(encoding="utf-8")
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
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (
        1024**2 if sys.platform == "darwin" else 1024
    )
    sizes = {kind: len(blocks[kind]) for kind in BLOCK_ORDER}
    print(
        json.dumps(
            {
                "output": str(output),
                "htmlBytes": output.stat().st_size,
                "buildSeconds": round(elapsed, 2),
                "peakRssMiB": round(rss, 1),
                "blocks": sizes,
                "files": f,
                "dirs": len(dirs),
            },
            ensure_ascii=False,
        )
    )
    if args.open:
        import webbrowser

        webbrowser.open(output.resolve().as_uri())


if __name__ == "__main__":
    main()
