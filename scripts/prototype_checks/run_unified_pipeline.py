"""实际测量压力输入生成＋L1/L2校验＋统一HTML打包的端到端时间和进程树RSS。"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import psutil

from scripts.prototype_checks.measure_unified_capacity import TreeSampler
from scripts.prototype_checks.run_baseline import ROOT, dump, fingerprint


def run_phase(command: list[str], log: Path) -> int:
    """超时清理本次命令的后代，不留下继续生成数据的子进程。"""
    with (
        log.open("w", encoding="utf-8") as stream,
        subprocess.Popen(
            command,
            cwd=ROOT,
            stdout=stream,
            stderr=subprocess.STDOUT,
            start_new_session=os.name == "posix",
        ) as process,
    ):
        try:
            return process.wait(timeout=1800)
        except subprocess.TimeoutExpired:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                for child in psutil.Process(process.pid).children(recursive=True):
                    with contextlib.suppress(psutil.NoSuchProcess):
                        child.kill()
                process.kill()
            process.wait()
            raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--files", type=int, default=100000)
    args = parser.parse_args()
    if args.files < 1:
        parser.error("files必须为正整数")
    output = args.output.resolve()
    if output.exists() or not output.is_relative_to(ROOT / "output/unified-prototype"):
        parser.error("输出必须为output/unified-prototype下不存在的新目录")
    output.mkdir(parents=True)
    input_dir, report_dir = output / "input", output / "report"
    commands = [
        (
            "generate-and-L1L2",
            [
                sys.executable,
                "-m",
                "scripts.prototype_scale_data",
                "--num-files",
                str(args.files),
                "--shape",
                "mixed",
                "--change-rate",
                "1",
                "--churn-rate",
                "0",
                "--validate",
                "L1L2",
                "--output-dir",
                str(input_dir),
            ],
        ),
        (
            "compact-report",
            [
                sys.executable,
                "-m",
                "prototypes.ui.prototype",
                "--input-dir",
                str(input_dir),
                "--output-dir",
                str(report_dir),
            ],
        ),
    ]
    source_paths = sorted(
        {
            ROOT / "scripts/prototype_scale_data.py",
            *(ROOT / "src/cmetrics_cmp_viz").rglob("*.py"),
            ROOT / "schemas/cmetrics-report.schema.json",
            *(ROOT / "prototypes").rglob("*.py"),
            *(ROOT / "prototypes").rglob("*.js"),
            *(ROOT / "prototypes").rglob("*.css"),
            *(ROOT / "prototypes").rglob("*.html"),
            Path(__file__).resolve(),
            ROOT / "scripts/prototype_checks/measure_unified_capacity.py",
            ROOT / "scripts/prototype_checks/run_baseline.py",
            ROOT / "pyproject.toml",
            ROOT / "uv.lock",
        }
    )
    result: dict[str, Any] = {
        "protocol": "generate-L1L2-report-1",
        "filesPerSide": args.files,
        "sources": [fingerprint(p) for p in source_paths],
        "phases": [],
        "status": "running",
        "businessValidationAccepted": False,
        "compatibilityAccepted": False,
        "limitations": [
            "本机模拟扫描，不是实际源文件扫描",
            "执行L1/L2；未物化全部有效代码行的内部模型，不冒充完整L3或内容MD5核验",
            "RSS100ms采样可能漏掉瞬时峰值，共享页重计；读取竞态阻止本地资源门槛通过",
            "小规模仅校准；Windows及其他浏览器未测",
        ],
    }
    dump(output / "results.json", result)
    started = time.perf_counter()
    sampler = TreeSampler(pid=os.getpid())
    sampler.phase = "pipeline"
    sampler.thread.start()
    try:
        for phase, command in commands:
            sampler.phase = phase
            begin = time.perf_counter()
            record: dict[str, Any] = {"phase": phase, "command": command, "status": "running"}
            result["phases"].append(record)
            dump(output / "results.json", result)
            try:
                record["returncode"] = run_phase(command, output / f"{phase}.log")
                record["status"] = "completed" if record["returncode"] == 0 else "failed"
            except Exception as exc:
                record["status"] = (
                    "timeout" if isinstance(exc, subprocess.TimeoutExpired) else "failed"
                )
                record["error"] = f"{type(exc).__name__}: {exc}"
                raise
            finally:
                record["wallSeconds"] = time.perf_counter() - begin
                dump(output / "results.json", result)
            if record["returncode"]:
                raise RuntimeError(f"{phase}失败，见独立日志")
        result["artifact"] = fingerprint(report_dir / "cmetrics-prototype.html")
        result["inputs"] = [
            fingerprint(input_dir / name)
            for name in ("baseline.json", "current.json", "manifest.json")
        ]
        manifest = json.loads((input_dir / "manifest.json").read_text(encoding="utf-8"))
        result["validation"] = manifest.get("checksPassed")
        result["inputScale"] = {
            side: {
                key: manifest[side][key] for key in ("files_total", "methods_total", "code_size")
            }
            for side in ("baseline", "current")
        }
        result["requiredScaleMet"] = all(
            side["files_total"] >= 100000
            and side["methods_total"] >= 1000000
            and side["code_size"] >= 25000000
            for side in result["inputScale"].values()
        )
        if result["validation"] != "L1L2" or any(
            side["files_total"] != args.files for side in result["inputScale"].values()
        ):
            raise RuntimeError("输入规模或L1/L2校验台账不符合本次命令")
        result["sourcesAfter"] = [fingerprint(p) for p in source_paths]
        result["sourcesStable"] = result["sources"] == result["sourcesAfter"]
        result["status"] = "measured-not-accepted"
    except Exception as exc:
        result["status"] = "failed"
        result["error"] = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        sampler.stop()
        result["totalWallSeconds"] = time.perf_counter() - started
        dump(output / "rss-samples.json", sampler.samples)
        result["memory"] = sampler.summary()
        peak = result["memory"].get("peakRssBytes")
        result["resourceEvidenceHasReadRaces"] = result["memory"].get("samplingErrorCount", 0) > 0
        # 根进程自身也计入绝对RSS；此处无空浏览器基线，不使用coverageComplete。
        result["resourceSamplesComplete"] = (
            bool(sampler.samples)
            and all(sample["processes"] and not sample["errors"] for sample in sampler.samples)
            and result["memory"].get("samplingErrorCount") == 0
        )
        result["withinTimeAndMemoryLimits"] = (
            result["status"] == "measured-not-accepted"
            and result.get("sourcesStable") is True
            and result["resourceSamplesComplete"]
            and isinstance(peak, (int, float))
            and 0 < peak <= 8 * 1024**3
            and result["totalWallSeconds"] <= 600
        )
        result["localRequiredScaleTimeAndMemoryGate"] = (
            result.get("requiredScaleMet", False) and result["withinTimeAndMemoryLimits"]
        )
        dump(output / "results.json", result)
    print(
        json.dumps(
            {
                "output": str(output),
                "wallSeconds": result["totalWallSeconds"],
                "withinLimits": result["withinTimeAndMemoryLimits"],
                "requiredScaleMet": result["requiredScaleMet"],
                "businessValidationAccepted": False,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
