"""以现有 UI 模板承载紧凑数据；仅用于分阶段原型验证。"""

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from prototypes.performance.prototype_capacity import BLOCK_ORDER, build_payload, json_block
from prototypes.resource_usage import peak_rss_mib
from prototypes.ui.prototype import safe_json, static_overview


def build_compact_report(
    input_dir: Path,
    output_dir: Path,
    *,
    production_preview: bool = False,
    ui_meta: dict[str, Any] | None = None,
) -> Path:
    started = time.perf_counter()
    meta, blocks = build_payload(input_dir)
    if ui_meta and ui_meta.get("storyPaths"):
        meta["storyPaths"] = ui_meta["storyPaths"]
        blocks["meta"] = json_block(meta)
    hashes = {}
    for side in ("baseline", "current"):
        with (input_dir / f"{side}.json").open("rb") as stream:
            hashes[side] = hashlib.file_digest(stream, "sha256").hexdigest()
    identities = {
        side: {"repository": meta["root"].rstrip("/").rsplit("/", 1)[-1], "version": side}
        for side in ("baseline", "current")
    }
    display_meta = {
        "seed": meta["scale"]["seed"],
        "commonRoot": meta["root"],
        "metricNames": meta["metricNames"],
        "identities": identities,
        "sha256": hashes,
        "thresholdTransitions": meta["thresholdTransitions"],
        "limitations": [
            "已知模拟结构的原型；真实 Cmetrics 输入待内部核验。",
            "全部明细内嵌保留，当前阶段验证文件与目录任务。",
            "压力输入尚未完成全量分层校验，不代表最终验收通过。",
        ],
        **(ui_meta or {}),
        "compact": True,
        "unionFiles": meta["scale"]["unionFiles"],
    }
    data = {"meta": display_meta}
    for side in ("baseline", "current"):
        data[side] = {"summary_metrics": meta["summaries"][side]}
    directory = Path(__file__).parent
    worker = (directory.parent / "performance" / "large_worker.js").read_text(encoding="utf-8")
    worker += "\n" + (directory / "ui_queries.js").read_text(encoding="utf-8")
    worker += "\n" + (directory / "ui_impact.js").read_text(encoding="utf-8")
    if (directory / "ui_evidence.js").exists():
        worker += "\n" + (directory / "ui_evidence.js").read_text(encoding="utf-8")
    worker += "\n" + (directory / "ui_worker.js").read_text(encoding="utf-8")
    script = (directory / "query_reader.js").read_text(encoding="utf-8")
    script += "\n" + (directory / "prototype.js").read_text(encoding="utf-8")
    if "</script" in worker.lower() or "</script" in script.lower():
        raise ValueError("脚本中包含 HTML script 结束标记，拒绝内嵌")
    assets = f'<script type="text/plain" id="report-worker">{worker}</script>\n'
    assets += "\n".join(
        f'<script type="application/octet-stream" data-block-kind="{kind}">{blocks[kind]}</script>'
        for kind in BLOCK_ORDER
    )
    template = (directory / "report.html").read_text(encoding="utf-8")
    # 资产先于不可信 JSON 注入；输入中的模板标记不再参与替换。
    for marker, value in {
        "@@STYLE@@": (directory / "prototype.css").read_text(encoding="utf-8"),
        "@@SCRIPT@@": script,
        "@@PROTOTYPE_MODE@@": "false" if production_preview else "true",
        "@@READER_ASSETS@@": assets,
        "@@STATIC@@": static_overview(data),
        "@@DATA@@": safe_json(data),
    }.items():
        template = template.replace(marker, value)
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / "cmetrics-prototype.html"
    temporary = output_dir / ".cmetrics-prototype.html.tmp"
    temporary.write_text(template, encoding="utf-8")
    temporary.replace(destination)
    print(
        json.dumps(
            {
                "output": str(destination),
                "htmlBytes": destination.stat().st_size,
                "buildSeconds": round(time.perf_counter() - started, 3),
                "peakRssMiB": round(peak_rss_mib(), 1),
                "inputSha256": hashes,
                "validation": "分阶段原型；当前构建不包含完整压力输入校验",
            },
            ensure_ascii=False,
        )
    )
    return destination
