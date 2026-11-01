"""顺序执行本机容量矩阵、独立完整查询核验与长时；检查点可分阶段续跑。"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from scripts.prototype_checks.measure_unified_capacity import MATRIX
from scripts.prototype_checks.run_baseline import ROOT, dump, fingerprint


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--input-root", type=Path, default=ROOT / "output/unified-prototype/stage5-inputs"
    )
    parser.add_argument(
        "--browser",
        type=Path,
        default=Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    )
    parser.add_argument("--phase", choices=("all", "short", "oracle", "soak"), default="all")
    parser.add_argument("--groups", help="可选的逗号分隔组名；默认十组必测")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    checkpoint = output / "matrix.json"
    result: dict[str, Any] = (
        json.loads(checkpoint.read_text())
        if checkpoint.exists()
        else {
            "started": time.time(),
            "groups": {},
            "orchestrator": fingerprint(Path(__file__)),
            "limitations": [
                "Windows Chrome/Edge及macOS Edge未测",
                "独立Oracle与浏览器采样分时执行，OS缓存不受控制",
                "脚本完成不等于全部门槛或全平台验收通过",
            ],
        }
    )
    selected = set(args.groups.split(",")) if args.groups else None
    configs = [
        row
        for row in MATRIX
        if row["files"] == 100000 and (selected is None or row["name"] in selected)
    ]
    phases = ("short", "oracle", "soak") if args.phase == "all" else (args.phase,)

    def execute(command: list[str], phase: str, name: str) -> dict[str, Any]:
        log = output / f"{name}-{phase}.log"
        started = time.time()
        record = {"command": command, "started": started, "status": "running", "log": str(log)}
        result["groups"].setdefault(name, {})[phase] = record
        dump(checkpoint, result)
        print(f"开始 {phase} {name}", flush=True)
        try:
            with log.open("w") as stream:
                completed = subprocess.run(
                    command,
                    cwd=ROOT,
                    stdout=stream,
                    stderr=subprocess.STDOUT,
                    timeout=7200,
                    check=False,
                )
            record.update(
                returncode=completed.returncode,
                status="completed" if completed.returncode == 0 else "failed",
            )
        except subprocess.TimeoutExpired:
            record.update(status="timeout")
        record["finished"] = time.time()
        dump(checkpoint, result)
        print(f"完成 {phase} {name}：{record['status']}", flush=True)
        return record

    for phase in phases:
        for config in configs:
            name = config["name"]
            if phase == "soak" and name != "full-mixed":
                continue
            if result["groups"].get(name, {}).get(phase, {}).get("status") == "completed":
                continue
            input_dir = (args.input_root / name).resolve()
            measured = output / "short" / name
            if phase == "short":
                execute(
                    [
                        sys.executable,
                        "-m",
                        "scripts.prototype_checks.measure_unified_capacity",
                        "--input-dir",
                        str(input_dir),
                        "--browser",
                        str(args.browser),
                        "--output-dir",
                        str(measured),
                        "--cold-runs",
                        "20",
                        "--hot-samples",
                        "20",
                        "--soak-seconds",
                        "0",
                    ],
                    phase,
                    name,
                )
            elif phase == "oracle":
                if not (measured / "results.json").exists():
                    result["groups"].setdefault(name, {})[phase] = {
                        "status": "blocked-missing-measurement"
                    }
                    dump(checkpoint, result)
                    continue
                measurement = json.loads((measured / "results.json").read_text())
                states = {}
                for run in measurement.get("runs", []):
                    for mode in ("cold", "hot"):
                        for batch in run.get(mode, []):
                            for sample in batch:
                                state = sample.get("state")
                                if state is not None:
                                    states[json.dumps(state, sort_keys=True)] = state
                states_path = output / f"{name}-measured-query-states.json"
                dump(states_path, list(states.values()))
                oracle = output / f"stage5-oracle-{name}"
                record = execute(
                    [
                        "node",
                        "--max-old-space-size=6144",
                        "scripts/prototype_checks/check-unified-scale-oracle.cjs",
                        str(input_dir),
                        measurement["artifact"]["path"],
                        str(oracle),
                        str(states_path),
                    ],
                    phase,
                    name,
                )
                record["output"] = str(oracle)
                dump(checkpoint, result)
            else:
                measurement = json.loads((measured / "results.json").read_text())
                execute(
                    [
                        sys.executable,
                        "-m",
                        "scripts.prototype_checks.measure_unified_capacity",
                        "--input-dir",
                        str(input_dir),
                        "--report",
                        measurement["artifact"]["path"],
                        "--browser",
                        str(args.browser),
                        "--output-dir",
                        str(output / "soak" / name),
                        "--cold-runs",
                        "1",
                        "--hot-samples",
                        "1",
                        "--soak-seconds",
                        "1800",
                    ],
                    phase,
                    name,
                )
    result["lastPhaseFinished"] = time.time()
    dump(checkpoint, result)


if __name__ == "__main__":
    main()
