"""大规模证据热点的20冷/20热DOM测量；绑定独立raw完整集合核验。"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

from scripts.prototype_checks.measure_unified_capacity import (
    MAX_CHANNEL_RETRIES,
    CapacityBrowser,
    channel_error_signature,
    discard_session,
)
from scripts.prototype_checks.run_baseline import ROOT, dump, fingerprint

# 页面测量探针的就绪等待窗口；ready>10s 门槛仍在就绪后由 Python 侧判定。
STARTUP_WAIT_TIMEOUT_MS = 30000


class StartupProbeError(RuntimeError):
    """页面测量探针缺失/未就绪的结构化 startup 失败。

    startup（已序列化的部分）与页面状态快照附在实例属性上，
    调用方应将其存入 run["startup"] 后再让会话按普通失败语义停止。
    """

    def __init__(self, message: str, startup: dict[str, Any], snapshot: dict[str, Any]) -> None:
        super().__init__(message)
        self.startup = startup
        self.snapshot = snapshot


def page_state_snapshot(browser: CapacityBrowser) -> dict[str, Any]:
    """探针异常时尽力抓取页面状态快照；抓取失败不掩盖原错误。"""
    try:
        return browser.evaluate(
            "({readyState:document.readyState,"
            "interactiveReady:document.documentElement.classList.contains('interactive-ready'),"
            "probeType:typeof window.__prototypeMeasure,"
            "probeKeys:window.__prototypeMeasure instanceof Object"
            "?Object.keys(window.__prototypeMeasure):null,"
            "title:document.title,scripts:document.scripts.length,"
            "bodyChildren:document.body?document.body.children.length:null})"
        )
    except Exception as error:
        return {"snapshotError": str(error)}


def open_report_checked(browser: CapacityBrowser, report: Path) -> dict[str, Any]:
    """打开报告，等待测量探针存在且就绪后序列化 startup。

    基线 Browser.open_report 的 wait 条件
    `window.__prototypeMeasure?.readyPaintMs !== null` 在探针对象缺失时恒真
    （undefined !== null），未真正等待页面就绪；探针缺失时序列化结果缺 probe
    键，调用方裸取会以 KeyError 逃逸（stage5-handoff-evidence-exec-2 第 20
    冷会话）。此处要求对象存在且 readyPaintMs 非空（带超时），缺失时抛
    结构化 StartupProbeError（含页面状态快照）。
    """
    browser.sampler.phase = "report"
    browser.call("open", report.as_uri())
    try:
        browser.call(
            "wait",
            "--timeout",
            str(STARTUP_WAIT_TIMEOUT_MS),
            "--fn",
            "window.__prototypeMeasure && window.__prototypeMeasure.readyPaintMs !== null"
            " && document.documentElement.classList.contains('interactive-ready')",
        )
    except Exception as error:
        raise StartupProbeError(
            f"等待页面测量探针超时或失败：{error}",
            startup={},
            snapshot=page_state_snapshot(browser),
        ) from error
    startup = browser.evaluate(
        "(async () => ({probe:window.__prototypeMeasure,"
        "navigation:performance.getEntriesByType('navigation')[0].toJSON(),"
        "browserVersion:navigator.userAgentData"
        " ? await navigator.userAgentData.getHighEntropyValues(['fullVersionList']) : null}))()"
    )
    probe = startup.get("probe")
    if not isinstance(probe, dict) or probe.get("readyPaintMs") is None:
        raise StartupProbeError(
            "startup序列化缺少probe或readyPaintMs未就绪（页面测量探针缺失）",
            startup=startup,
            snapshot=page_state_snapshot(browser),
        )
    return startup


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proof", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--browser",
        type=Path,
        default=Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    )
    parser.add_argument("--cold-runs", type=int, default=20)
    parser.add_argument("--hot-samples", type=int, default=20)
    parser.add_argument("--smoke", action="store_true", help="允许小集合校准，永不判为容量通过")
    parser.add_argument("--validate-only", action="store_true", help="只校验证据绑定，不启动浏览器")
    args = parser.parse_args()
    if args.cold_runs < 1 or args.hot_samples < 1:
        parser.error("冷会话和热样本数必须为正整数")
    output = args.output.resolve()
    if output.exists() or not output.is_relative_to(ROOT / "output/unified-prototype"):
        parser.error("输出目录必须为output/unified-prototype下不存在的新目录")
    output.mkdir(parents=True)
    report, proof_path = args.report.resolve(), args.proof.resolve()
    proof = json.loads(proof_path.read_text())
    with report.open("rb") as stream:
        artifact_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    if (
        proof.get("protocol") != "full-filtered-evidence-1"
        or proof.get("failed") != 0
        or proof.get("htmlSha256") != artifact_hash
        or not proof.get("tasks")
        or proof.get("checks") != len(proof["tasks"])
        or not all(task.get("pass") is True for task in proof["tasks"])
    ):
        raise RuntimeError("完整集合证据未通过、结构不符或HTML摘要不符")
    expected_keys = {
        (kind, key, requested)
        for kind in ("duplication", "sourceDuplication", "dupfiles", "sourceDupfiles")
        for key in (
            "groups-baseline",
            "fragments-baseline",
            "groups-current",
            "fragments-current",
            "peers",
        )
        for requested in (1, 50, 51, 1000000000)
    } | {("folders", "members", requested) for requested in (1, 50, 51, 1000000000)}
    actual_keys = {
        (task["type"], task.get("key", "members"), task["requested"])
        for task in proof["tasks"]
        if not task.get("query") and task.get("memberStatus", "all") == "all"
    }
    if actual_keys != expected_keys:
        raise RuntimeError("完整集合证据缺少类型、侧别或分页覆盖")
    if args.validate_only:
        dump(
            output / "validation.json",
            {
                "status": "proof-validated-browser-not-run",
                "checks": proof["checks"],
                "artifact": fingerprint(report),
                "proof": fingerprint(proof_path),
            },
        )
        return
    script = (ROOT / "scripts/prototype_checks/check-unified-scale-evidence-browser.js").read_text()
    source_paths = [
        Path(__file__).resolve(),
        ROOT / "scripts/prototype_checks/check-unified-scale-evidence-browser.js",
        ROOT / "scripts/prototype_checks/measure_unified_capacity.py",
        ROOT / "scripts/prototype_checks/run_baseline.py",
        *sorted((ROOT / "prototypes").rglob("*.js")),
        *sorted((ROOT / "prototypes").rglob("*.py")),
    ]
    result: dict[str, Any] = {
        "protocol": "scale-evidence-DOM-3",
        "command": sys.argv,
        "smoke": args.smoke,
        "artifact": fingerprint(report),
        "proof": fingerprint(proof_path),
        "sources": [fingerprint(p) for p in source_paths],
        "runs": [],
        "limitations": [
            "本机Chrome，Windows Chrome/Edge和macOS Edge未测",
            "cold表示独立profile内本任务首次计时；计时前回首页，前序任务和首页可能建立共享索引；OS缓存未清空",
            "同一会话中深页先于末页，两者分别统计20个cold及20个hot样本",
            "完整集合由独立raw SHA256核验，DOM窗口与该结果逐项对应",
            "RSS抽样可能漏峰，共享页重计，读取竞态保留",
            "agent-browser与Chrome DevTools的WebSocket通道偶发reset（判定见stage5-cdp-repro/verdict.md）："
            "命中签名的失败会话整体丢弃，关闭残留会话后以新profile重建同编号会话重跑（每会话最多重试3次）；"
            "重试登记于channelRetries、被弃产物保留在discarded/，重试会话的计时与P95语义与首次一致",
            "startup等待要求页面测量探针存在且readyPaintMs非空（30秒超时）："
            "探针缺失/未就绪时会话以结构化startup失败停止（startup内含probeFailure页面状态快照），"
            "不再以裸KeyError逃逸；该失败非通道签名，不触发会话重试",
        ],
    }
    failed = False

    def run_session(index: int) -> dict[str, Any]:
        """跑完一个编号的冷会话；DevTools通道断开时整会话丢弃、新profile重建重跑。

        会话级重试：命中通道签名的失败尝试（含其已采样本）不并入统计，
        产物移入discarded/；重试不改变计时、采样与汇总语义。
        """
        attempt = 0
        while True:
            attempt += 1
            print(
                f"冷会话 {index + 1}/{args.cold_runs}"
                + (f"（通道重试 {attempt - 1}/{MAX_CHANNEL_RETRIES}）" if attempt > 1 else ""),
                flush=True,
            )
            browser = CapacityBrowser(output / f"cold-{index + 1:02}", args.browser, headed=False)
            run: dict[str, Any] = {"index": index + 1, "cold": [], "hot": []}
            if len(result["runs"]) > index:
                result["runs"][index] = run
            else:
                result["runs"].append(run)
            failure: BaseException | None = None
            try:
                run["browser"] = browser.start()
                try:
                    run["startup"] = open_report_checked(browser, report)
                except StartupProbeError as error:
                    run["startup"] = {
                        **error.startup,
                        "probeFailure": {"error": str(error), "pageState": error.snapshot},
                    }
                    raise
                if run["startup"]["probe"]["readyPaintMs"] > 10000:
                    raise RuntimeError("就绪超过10秒门槛")
                for mode, batches in (("cold", 1), ("hot", args.hot_samples if index == 0 else 0)):
                    browser.sampler.phase = mode + "-evidence"
                    for batch in range(batches):
                        cfg = {
                            "tasks": proof["tasks"],
                            "batch": batch + 1 if mode == "hot" else 0,
                            "smoke": args.smoke,
                        }
                        checked = browser.evaluate(
                            script.replace("CONFIG", json.dumps(cfg, ensure_ascii=False))
                        )
                        if checked.get("result") != "passed" or not checked.get("tasks"):
                            raise RuntimeError("大规模证据DOM检查失败或没有深页任务")
                        samples = checked["tasks"]
                        names = [sample["task"] for sample in samples]
                        if len(set(names)) != len(names) or len(names) != 26:
                            raise RuntimeError("证据DOM任务覆盖不完整或重复（期望26项）")
                        run[mode].append(samples)
                        dump(output / "results.json", result)
                        print(
                            f"冷会话 {index + 1}/{args.cold_runs} {mode} {batch + 1}/{batches}",
                            flush=True,
                        )
                run["errors"] = browser.call("errors")
                run["network"] = browser.call("network", "requests")
                if run["errors"].get("errors") or any(
                    r.get("url", "").startswith(("http:", "https:"))
                    for r in run["network"].get("requests", [])
                ):
                    raise RuntimeError("脚本错误或外连请求")
                run["status"] = "sampled"
            except Exception as error:
                run.update(status="failed", error=str(error))
                failure = error
            finally:
                try:
                    run["memory"] = browser.finish()
                    if run["memory"].get("peakIncrementBytes", 0) > 2 * 1024**3:
                        run.update(status="failed", error="浏览器新增进程树RSS超过2GiB")
                except Exception as error:
                    run["cleanupError"] = str(error)
                    failure = failure or error
                dump(output / "results.json", result)
            signature = channel_error_signature(failure)
            if signature is None or attempt > MAX_CHANNEL_RETRIES:
                return run
            result["runs"].pop(index)
            result.setdefault("channelRetries", []).append(
                {
                    "phase": browser.sampler.phase,
                    "runIndex": index + 1,
                    "attempt": attempt,
                    "errorSignature": signature,
                    "discardedEvidencePath": discard_session(browser, attempt),
                }
            )
            dump(output / "results.json", result)
            print(
                f"DevTools通道断开（{signature}）：丢弃会话{index + 1}第{attempt}次尝试，"
                "以新profile重建同编号会话重跑",
                flush=True,
            )

    for index in range(args.cold_runs):
        run = run_session(index)
        if run["status"] != "sampled" or "cleanupError" in run:
            failed = True
            break
    summaries = []
    for mode in ("cold", "hot"):
        tasks: dict[str, list[dict[str, Any]]] = {}
        for run in result["runs"]:
            for batch in run[mode]:
                for sample in batch:
                    tasks.setdefault(sample["task"], []).append(sample)
        for task, samples in tasks.items():
            ordered = sorted(s["elapsedMs"] for s in samples)
            value = ordered[math.ceil(len(ordered) * 0.95) - 1] if len(ordered) >= 20 else None
            summaries.append(
                {
                    "mode": mode,
                    "task": task,
                    "count": len(samples),
                    "p95Ms": value,
                    "correct": all(s["valid"] and s["changed"] for s in samples),
                    "withinLimit": value is not None and value <= 1000,
                }
            )
    result["sourcesAfter"] = [fingerprint(p) for p in source_paths]
    result["sourcesStable"] = result["sources"] == result["sourcesAfter"]
    result["summaries"] = summaries
    result["status"] = "failed" if failed else "measured-not-accepted"
    result["bindingStable"] = result["artifact"] == fingerprint(report) and result[
        "proof"
    ] == fingerprint(proof_path)
    result["localQueryAndLatencyGate"] = (
        not args.smoke
        and result["bindingStable"]
        and len(summaries) == 52
        and not failed
        and result["sourcesStable"]
        and len(result["runs"]) >= 20
        and args.hot_samples >= 20
        and {t["mode"] for t in summaries} == {"cold", "hot"}
        and all(t["count"] >= 20 and t["correct"] and t["withinLimit"] for t in summaries)
    )
    dump(output / "results.json", result)
    print(
        json.dumps(
            {
                "output": str(output),
                "status": result["status"],
                "localGate": result["localQueryAndLatencyGate"],
            },
            ensure_ascii=False,
        )
    )
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
