"""一条命令构建受控合成数据与自包含 UI 原型；不代表正式生产交付。"""

import argparse
import hashlib
import html
import json
import re
import sys
import webbrowser
from collections import Counter
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

from cmetrics_cmp_viz.schema import is_header_file
from cmetrics_cmp_viz.validator import validate_l0, validate_l1, validate_l2, validate_l3
from prototypes.ui.prototype_data import ROOT, STORY_PATHS, generate_side, make_ledger

MAIN_METRICS = [
    ("code_size", "非空非注释代码行"),
    ("lines_per_file", "非空非注释代码行／文件"),
    ("lines_per_method", "非空非注释代码行／函数"),
    ("cyclomatic_complexity_per_method", "复杂度／函数"),
    ("code_duplication_ratio", "%（差值为百分点）"),
    ("file_duplication_ratio", "%（差值为百分点）"),
    ("unsafe_functions_total", "去重位置数"),
    ("redundant_code_total", "代码块数"),
    ("non_hfile_code_duplication_ratio", "%（差值为百分点）"),
    ("non_hfile_duplication_ratio", "%（差值为百分点）"),
    ("huge_headerfile_total", "文件数"),
    ("huge_headerfile_ratio", "%（差值为百分点）"),
    ("huge_non_headerfile_total", "文件数"),
    ("huge_non_headerfile_ratio", "%（差值为百分点）"),
    ("huge_method_total", "函数数"),
    ("huge_method_ratio", "%（差值为百分点）"),
    ("huge_cyclomatic_complexity_total", "函数数"),
    ("huge_cyclomatic_complexity_ratio", "%（差值为百分点）"),
    ("huge_folder_total", "目录数"),
    ("huge_folder_ratio", "%（差值为百分点）"),
]
LIMITATIONS = [
    "模拟数据原型，未进行真实性能与容量验收。",
    "同文件 parse / func_worker 重名，不提供确定逐函数配对；行号移动仅表示扫描记录进出。",
    "模拟数据已检查内部一致性，不代表真实扫描结果。",
    "重复组号仅在各侧扫描内有效；超大目录仅恢复扫描可见直接成员，不读取磁盘。",
    "全部明细保留，异常样例不改变原始数据。",
]


def json_text(value: Any) -> str:
    """固定序列化格式，供文件、输入摘要和 L0 校验共用。"""
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def safe_json(value: Any) -> str:
    """阻断 HTML script 提前闭合及特殊行分隔符。"""
    text = json_text(value)
    for char in ("<", ">", "&", "\u2028", "\u2029"):
        text = text.replace(char, f"\\u{ord(char):04x}")
    return text


def fill_template(template: str, replacements: dict[str, str]) -> str:
    """只解释原模板的标记一次，数据中的同名文本保持原样。"""
    return re.sub(r"@@[A-Z_]+@@", lambda match: replacements.get(match[0], match[0]), template)


def load_metric_names() -> dict[str, str]:
    """以 docs 中用户维护的文件为唯一名称来源，容忍 key 两侧的多余引号。"""
    source = Path(__file__).resolve().parents[2] / "docs" / "metric_names.md"
    names = {}
    for line in source.read_text(encoding="utf-8").splitlines():
        if ":" in line:
            key, label = line.split(":", 1)
            names[key.strip().strip("\"'")] = label.strip()
    return names


THRESHOLD_KEYS = {
    "hugeHeader": "huge_headerfile",
    "hugeSource": "huge_non_headerfile",
    "hugeMethod": "huge_method",
    "hugeCC": "huge_cyclomatic_complexity",
    "folders": "huge_folder",
}


def threshold_comparison(
    before: dict[str, Any], after: dict[str, Any], kind: str
) -> dict[str, Any]:
    """阈值变化是观测比较的提示，不是停用详情的原因。"""
    key = THRESHOLD_KEYS[kind]
    b, c = before["huge_threshold"][key], after["huge_threshold"][key]
    changed = b != c
    return {
        "thresholdChanged": changed,
        "baselineThreshold": b,
        "currentThreshold": c,
        "warning": (
            f"阈值变化：基线 > {b}；当前 > {c}。两侧分别严格大于判定；"
            "清单进出可能由阈值变化造成，不证明代码恶化或改善。"
            if changed
            else None
        ),
    }


def threshold_transitions(baseline: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    """按真实超限对象集合计数；任一侧重名的函数键不参与进出判定。"""
    ambiguous = set()
    for report in (baseline, current):
        counts = Counter(
            (m["file_name"], m["method_name"])
            for m in report["detail_metrics"]["method_metrics"][:-1]
        )
        ambiguous.update(key for key, count in counts.items() if count > 1)

    def objects(report: dict[str, Any]) -> dict[str, set[Any]]:
        detail = report["detail_metrics"]
        thresholds = report["summary_metrics"]["huge_threshold"]
        methods = detail["method_metrics"][:-1]

        def method_key(method: dict[str, Any]) -> tuple[str, str]:
            return (method["file_name"], method["method_name"])

        return {
            "hugeHeader": {
                p
                for p, v in detail["file_sizes"].items()
                if is_header_file(p) and v[0] > thresholds["huge_headerfile"]
            },
            "hugeSource": {
                p
                for p, v in detail["file_sizes"].items()
                if not is_header_file(p) and v[0] > thresholds["huge_non_headerfile"]
            },
            "hugeMethod": {
                method_key(m)
                for m in methods
                if m["nbnc_loc"] > thresholds["huge_method"] and method_key(m) not in ambiguous
            },
            "hugeCC": {
                method_key(m)
                for m in methods
                if m["cyclomatic_complexity"] > thresholds["huge_cyclomatic_complexity"]
                and method_key(m) not in ambiguous
            },
            "folders": {
                p
                for p, count in detail["huge_folders"].items()
                if count > thresholds["huge_folder"]
            },
        }

    before, after = objects(baseline), objects(current)
    limited = {"hugeMethod": False, "hugeCC": False}
    for report in (baseline, current):
        for method in report["detail_metrics"]["method_metrics"][:-1]:
            if (method["file_name"], method["method_name"]) not in ambiguous:
                continue
            for kind, field, threshold in [
                ("hugeMethod", "nbnc_loc", "huge_method"),
                ("hugeCC", "cyclomatic_complexity", "huge_cyclomatic_complexity"),
            ]:
                if method[field] > report["summary_metrics"]["huge_threshold"][threshold]:
                    limited[kind] = True
    return {
        kind: {
            "entered": len(after[kind] - before[kind]),
            "exited": len(before[kind] - after[kind]),
            "limited": limited.get(kind, False),
            **threshold_comparison(baseline["summary_metrics"], current["summary_metrics"], kind),
        }
        for kind in before
    }


def prepare_data(seed: int) -> tuple[dict[str, Any], dict[str, str]]:
    """生成两侧并执行实际分层校验，任何失败都拒绝构建 HTML。"""
    baseline, b_model = generate_side(seed, False)
    current, c_model = generate_side(seed, True)
    ledger = make_ledger(baseline, current)
    validation = {}
    artifacts = {"change_ledger.json": json_text(ledger)}
    hashes = {}
    for side, report, model in [("baseline", baseline, b_model), ("current", current, c_model)]:
        raw = json_text(report)
        _, errors = validate_l0(raw)
        levels = {"L0": {"passed": not errors, "errors": errors}}
        for level, check in [
            ("L1", lambda r=report: validate_l1(r)),
            ("L2", lambda r=report: validate_l2(r)),
            ("L3", lambda r=report, m=model: validate_l3(r, m, ledger)),
        ]:
            if errors:
                raise ValueError(f"{side} 校验失败：" + "; ".join(errors))
            errors = check()
            levels[level] = {"passed": not errors, "errors": errors}
        if errors:
            raise ValueError(f"{side} 校验失败：" + "; ".join(errors))
        validation[side] = levels
        artifacts[f"{side}.json"] = raw
        artifacts[f"{side}_internal_model.json"] = json_text(model)
        hashes[side] = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    meta = {
        "seed": seed,
        "metricNames": load_metric_names(),
        "thresholdTransitions": threshold_transitions(baseline, current),
        "generatorVersion": "throwaway-prototype-1",
        "dataFormatVersion": "prototype-1",
        "commonRoot": ROOT,
        "validation": validation,
        "ledger": ledger,
        "storyPaths": STORY_PATHS,
        "sha256": hashes,
        "identities": {
            side: {
                "repository": "synthetic/cmetrics-demo",
                "branch": "demo/baseline" if side == "baseline" else "demo/current",
                "node": "未提供",
                "version": "v1-demo" if side == "baseline" else "v2-demo",
                "source": "合成演示身份，未验证",
            }
            for side in ("baseline", "current")
        },
        "limitations": LIMITATIONS,
        "retention": {"allDetailsRetained": True, "omittedRecords": 0},
        "anomalyScenarios": [
            {
                "id": "summary-conflict",
                "side": "current",
                "field": "summary_metrics.code_size",
                "operation": "+123",
                "label": "仅异常展示：扫描汇总与明细冲突",
            },
            {
                "id": "unknown-duplication",
                "side": "current",
                "path": STORY_PATHS["utilsGrow"],
                "field": "detail_metrics.file_sizes[path][2]",
                "value": None,
                "label": "仅异常展示：文件重复行未知，不得补零",
            },
            {
                "id": "threshold-change",
                "side": "current",
                "field": "summary_metrics.huge_threshold.huge_cyclomatic_complexity",
                "old": 20,
                "value": 25,
                "label": "阈值变化：两侧按各自阈值比较数值与清单进出，不证明代码恶化或改善",
            },
            {
                "id": "folder-coverage",
                "side": "current",
                "path": STORY_PATHS["bulk"],
                "field": "detail_metrics.huge_folders[path]",
                "operation": "+3",
                "label": "仅异常展示：扫描直接子项计数与可恢复成员数不符",
            },
        ],
    }
    return {"baseline": baseline, "current": current, "meta": meta}, artifacts


def display_number(value: int | float | Decimal, *, decimal: bool, delta: bool = False) -> str:
    """显示时按两位四舍五入；计数保持整数，不改变输入精度。"""
    number = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if not number:
        number = abs(number)
    digits = 2 if decimal else 0
    return ("+" if delta and number > 0 else "") + f"{number:,.{digits}f}"


def static_overview(data: dict[str, Any]) -> str:
    """无脚本时按两类保留全部分析指标与超限进出。"""
    rows = []
    category = None
    types = {
        "huge_headerfile_total": "hugeHeader",
        "huge_non_headerfile_total": "hugeSource",
        "huge_method_total": "hugeMethod",
        "huge_cyclomatic_complexity_total": "hugeCC",
        "huge_folder_total": "folders",
    }
    denominators = {
        "lines_per_file": "files_total",
        "lines_per_method": "methods_total",
        "cyclomatic_complexity_per_method": "methods_total",
        "code_duplication_ratio": "code_size",
        "non_hfile_code_duplication_ratio": "code_size",
        "file_duplication_ratio": "files_total",
        "non_hfile_duplication_ratio": "files_total",
        "huge_headerfile_ratio": "files_total",
        "huge_non_headerfile_ratio": "files_total",
        "huge_method_ratio": "methods_total",
        "huge_cyclomatic_complexity_ratio": "methods_total",
        "huge_folder_ratio": "folders_total",
    }
    for key, unit in MAIN_METRICS:
        current_category = "超大指标" if key.startswith("huge_") else "常规指标"
        if current_category != category:
            rows.append(f'<tr><th colspan="6">{current_category}</th></tr>')
            category = current_category
        before = data["baseline"]["summary_metrics"][key]
        after = data["current"]["summary_metrics"][key]
        integrity = data["meta"].get("integrity", {})
        reasons = [
            *integrity.get("comparisonIssues", []),
            *integrity.get("summaryIssues", {}).get(key, []),
        ]
        denominator = denominators.get(key)
        unavailable = {
            side: denominator is not None and data[side]["summary_metrics"].get(denominator) == 0
            for side in ("baseline", "current")
        }
        delta = (
            None
            if reasons or any(unavailable.values()) or before is None or after is None
            else Decimal(str(after)) - Decimal(str(before))
        )
        decimal = key.endswith(("_ratio", "_kloc", "_per_file", "_per_method"))
        transition = data["meta"]["thresholdTransitions"].get(
            types.get(key.replace("_ratio", "_total"))
        )
        movement = "—"
        if transition:
            movement = (
                "新增 — / 退出 —（无法确定配对）"
                if transition["limited"]
                else f"新增 {transition['entered']} / 退出 {transition['exited']}"
            )
        suffix = "%" if key.endswith("_ratio") else ""
        side_values = [
            "不适用"
            if unavailable[side]
            else "未知"
            if value is None
            else display_number(value, decimal=decimal) + suffix
            for side, value in (("baseline", before), ("current", after))
        ]
        values = [
            data["meta"]["metricNames"][key],
            *side_values,
            "—"
            if delta is None
            else display_number(delta, decimal=decimal, delta=True)
            + (" 个百分点" if suffix else ""),
            unit,
        ]
        cells = "".join(f"<td>{html.escape(value)}</td>" for value in values)
        if reasons:
            cells = cells.replace(
                "</td>", f'<p class="notice">{html.escape("；".join(reasons))}</p></td>', 1
            )
        movement = html.escape(movement)
        if transition and not transition["limited"]:
            movement = (
                f'<strong class="up">新增 {transition["entered"]}</strong> / '
                f'<strong class="down">退出 {transition["exited"]}</strong>'
            )
        if transition and integrity.get("comparisonIssues"):
            movement = "新增 — / 退出 —（比较口径或路径映射受限）"
        if transition and transition.get("warning"):
            movement += f'<p class="notice">{html.escape(transition["warning"])}</p>'
        rows.append(f'<tr data-static-metric="{html.escape(key)}">{cells}<td>{movement}</td></tr>')
    limits = "".join(
        f"<li>{html.escape(item)}</li>" for item in data["meta"].get("limitations", LIMITATIONS)
    )
    identities = data["meta"]["identities"]
    versions = html.escape(
        f"基线 {identities['baseline']['version']} → 当前 {identities['current']['version']}"
    )
    return (
        '<section class="static-fallback panel"><h2>静态概览 / 模拟数据</h2>'
        "<p>若交互未启动，仅可阅读此处，搜索、筛选与下钻不可用。</p>"
        f"<p>{versions}</p>"
        "<table><thead><tr><th>指标</th><th>基线</th><th>当前</th><th>变化</th>"
        "<th>单位</th><th>超限项进出</th></tr></thead><tbody>"
        + "".join(rows)
        + f"</tbody></table><details><summary>数据说明</summary><ul>{limits}</ul></details></section>"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="生成受控模拟数据与离线 UI 原型（非生产工具）")
    parser.add_argument("--seed", type=int, default=20261021)
    parser.add_argument("--input-dir", type=Path, help="从已知模拟输入及 manifest 构建紧凑报告")
    parser.add_argument("--compact", action="store_true", help="让标准故事夹具也走紧凑数据入口")
    parser.add_argument("--output-dir", type=Path, default=Path("output/prototype"))
    parser.add_argument(
        "--production-preview", action="store_true", help="仅隐藏原型调试状态，不代表正式生产"
    )
    parser.add_argument("--open", action="store_true", help="使用默认浏览器打开 file:// 报告")
    args = parser.parse_args()
    try:
        if args.input_dir:
            from prototypes.ui.compact_report import build_compact_report

            destination = build_compact_report(
                args.input_dir, args.output_dir, production_preview=args.production_preview
            )
            if args.open:
                webbrowser.open(destination.resolve().as_uri())
            return
        data, artifacts = prepare_data(args.seed)
        print("正常合成夹具：baseline/current 的 L0、L1、L2、L3 均通过。")
        output = args.output_dir
        output.mkdir(parents=True, exist_ok=True)
        for name, content in artifacts.items():
            (output / name).write_text(content, encoding="utf-8")
        if args.compact:
            from prototypes.ui.compact_report import build_compact_report
            from scripts.prototype_scale_data import scale_manifest

            manifest = scale_manifest(
                data["baseline"],
                data["current"],
                seed=args.seed,
                shape="story",
                num_files=data["current"]["summary_metrics"]["files_total"],
                methods_per_file=None,
                change_rate=None,
            )
            manifest["validation"] = "故事夹具 baseline/current 的 L0–L3 已通过"
            manifest.pop("coverageRule")
            (output / "manifest.json").write_text(json_text(manifest), encoding="utf-8")
            destination = build_compact_report(
                output, output, production_preview=args.production_preview, ui_meta=data["meta"]
            )
            if args.open:
                webbrowser.open(destination.resolve().as_uri())
            return
        template_dir = Path(__file__).parent
        template = (template_dir / "report.html").read_text(encoding="utf-8")
        # 单次替换不重新解释静态文案或 JSON 中的模板标记。
        replacements = {
            "@@STYLE@@": (template_dir / "prototype.css").read_text(encoding="utf-8"),
            "@@SCRIPT@@": (template_dir / "prototype.js").read_text(encoding="utf-8"),
            "@@PROTOTYPE_MODE@@": "false" if args.production_preview else "true",
            "@@READER_ASSETS@@": "",
            "@@STATIC@@": static_overview(data),
            "@@DATA@@": safe_json(data),
        }
        template = fill_template(template, replacements)
        destination = output / "cmetrics-prototype.html"
        temporary = output / ".cmetrics-prototype.html.tmp"
        temporary.write_text(template, encoding="utf-8")
        temporary.replace(destination)
        print(f"已生成：{destination.resolve()}（{destination.stat().st_size:,} bytes）")
        if args.open:
            webbrowser.open(destination.resolve().as_uri())
    except (OSError, ValueError) as exc:
        print(f"构建失败，未发布当前 HTML：{exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
