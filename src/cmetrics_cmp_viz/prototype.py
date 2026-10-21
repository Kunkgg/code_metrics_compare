"""一条命令构建受控合成数据与自包含 UI 原型；不代表正式生产交付。"""

import argparse
import hashlib
import html
import json
import sys
import webbrowser
from decimal import Decimal
from pathlib import Path
from typing import Any

from cmetrics_cmp_viz.prototype_data import ROOT, STORY_PATHS, generate_side, make_ledger
from cmetrics_cmp_viz.schema import round_half_up
from cmetrics_cmp_viz.validator import validate_l0, validate_l1, validate_l2, validate_l3

MAIN_METRICS = [
    ("code_size", "非空非注释代码量", "有效代码行"),
    ("lines_per_file", "平均文件代码行", "有效代码行／文件"),
    ("lines_per_method", "平均函数代码行", "有效代码行／函数"),
    ("cyclomatic_complexity_per_method", "平均圈复杂度", "复杂度／函数"),
    ("code_duplication_ratio", "代码重复率", "%（差值为百分点）"),
    ("file_duplication_ratio", "文件重复率", "%（差值为百分点）"),
    ("unsafe_functions_total", "危险函数", "去重位置数"),
    ("redundant_code_total", "冗余代码", "代码块数"),
    ("huge_cyclomatic_complexity_total", "超大圈复杂度", "函数数"),
    ("huge_method_total", "超大函数", "函数数"),
    ("huge_headerfile_total", "超大头文件", "文件数"),
    ("huge_non_headerfile_total", "超大源文件", "文件数"),
    ("huge_folder_total", "超大目录", "目录数"),
]
LIMITATIONS = [
    "一次性合成数据原型，不是正式生产报告；production-preview 仅隐藏原型切换器。",
    "同文件 parse / func_worker 重名，不提供确定逐函数配对；行号移动仅表示扫描记录进出。",
    "L0–L3 校验仅针对正常合成夹具；现有 L3 检查内部集合计数、整文件重复及台账结构，不证明真实扫描语义。",
    "重复组号仅在各侧扫描内有效；超大目录仅恢复扫描可见直接成员，不读取磁盘。",
    "全部小规模明细保留，未做容量、性能、真实数据或跨浏览器验收；异常展示与正常夹具隔离。",
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
                "label": "仅异常展示：阈值改变，应按新阈值派生清单并标不可直接比较",
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


def static_overview(data: dict[str, Any]) -> str:
    """无脚本时仍保留身份、13 主指标、口径和已知限制。"""
    rows = []
    for key, label, unit in MAIN_METRICS:
        before = data["baseline"]["summary_metrics"][key]
        after = data["current"]["summary_metrics"][key]
        delta = round_half_up(Decimal(str(after)) - Decimal(str(before)))
        values = [
            label,
            str(before),
            str(after),
            f"{delta:+g}",
            unit,
            f"summary_metrics.{key}；正常合成口径一致",
        ]
        rows.append(
            "<tr>" + "".join(f"<td>{html.escape(value)}</td>" for value in values) + "</tr>"
        )
    identities = "".join(
        f"<p><strong>{side}</strong>：{html.escape(json.dumps(identity, ensure_ascii=False))}<br>SHA-256：{data['meta']['sha256'][side]}</p>"
        for side, identity in data["meta"]["identities"].items()
    )
    limits = "".join(f"<li>{html.escape(item)}</li>" for item in LIMITATIONS)
    return (
        '<section class="static-fallback panel"><h2>静态概览 · 合成原型</h2><p>此概览由 Python 预生成。若交互未启动，仅可阅读此处，搜索、筛选与下钻不可用。</p>'
        + identities
        + f"<p>扫描公共根：{ROOT}；种子：{data['meta']['seed']}。两侧正常夹具 L0–L3 实际通过。</p><table><thead><tr><th>指标</th><th>baseline</th><th>current</th><th>差值</th><th>单位</th><th>来源及可比性</th></tr></thead><tbody>"
        + "".join(rows)
        + f"</tbody></table><h3>已知限制</h3><ul>{limits}</ul></section>"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="生成受控模拟数据与离线 UI 原型（非生产工具）")
    parser.add_argument("--seed", type=int, default=20261021)
    parser.add_argument("--output-dir", type=Path, default=Path("output/prototype"))
    parser.add_argument(
        "--production-preview", action="store_true", help="仅隐藏原型切换器，不代表正式生产"
    )
    parser.add_argument("--open", action="store_true", help="使用默认浏览器打开 file:// 报告")
    args = parser.parse_args()
    try:
        data, artifacts = prepare_data(args.seed)
        print("正常合成夹具：baseline/current 的 L0、L1、L2、L3 均通过。")
        output = args.output_dir
        output.mkdir(parents=True, exist_ok=True)
        for name, content in artifacts.items():
            (output / name).write_text(content, encoding="utf-8")
        template_dir = Path(__file__).parent / "prototype_ui"
        template = (template_dir / "report.html").read_text(encoding="utf-8")
        # 先替换模板资产，再注入不可信数据，避免数据中的占位符被二次解释。
        replacements = {
            "@@STYLE@@": (template_dir / "prototype.css").read_text(encoding="utf-8"),
            "@@SCRIPT@@": (template_dir / "prototype.js").read_text(encoding="utf-8"),
            "@@PROTOTYPE_MODE@@": "false" if args.production_preview else "true",
            "@@STATIC@@": static_overview(data),
            "@@DATA@@": safe_json(data),
        }
        for marker, value in replacements.items():
            template = template.replace(marker, value)
        destination = output / "cmetrics-prototype.html"
        temporary = output / ".cmetrics-prototype.html.tmp"
        temporary.write_text(template, encoding="utf-8")
        temporary.replace(destination)
        print(f"已生成：{destination.resolve()}（{destination.stat().st_size:,} bytes）")
        if args.open:
            webbrowser.open(destination.resolve().as_uri())
    except (OSError, ValueError) as exc:
        print(f"构建失败，未发布本次 HTML：{exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
