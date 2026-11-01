"""满规模（每侧 100k 文件／100 万函数）断网、Worker 故障、乱序与注入专项回放。

复验 07 小规模通过的全部故障面，适配满规模输入与报告：
断网加载、reader 失败保留旧结果与错误转义、重试、确定性旧成功／旧失败乱序、
查询注入、Worker 初始化／运行失败重试与静态兜底、指标名称注入、
路径／函数名注入（真实二进制打包与 DOM 查询链路）、failInit、去脚本静态页。

- 主报告复用 stage5 已验证 artifact（--report-sha256 校验）；
- 注入组现场构建：指标名称注入走 build_compact_report ui_meta，
  路径／函数名注入先经 mutate-full-injection.cjs 流式替换再构建；
- 浏览器阶段按 capacity 同款 DevTools 通道断连签名做会话级丢弃重试；
- 全部产物写全新输出目录，不覆盖既有证据。protocol: unified-resilience-full-1
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from prototypes.ui.compact_report import build_compact_report
from prototypes.ui.prototype import load_metric_names
from scripts.prototype_checks.run_baseline import dump, fingerprint

ROOT = Path(__file__).resolve().parents[2]
CHECKS = ROOT / "scripts/prototype_checks"
PROTOCOL = "unified-resilience-full-1"

# 与 measure_unified_capacity.py 相同的 DevTools 通道断连签名（stage5-cdp-repro 判定）。
CHANNEL_ERROR_SIGNATURES = (
    "CDP response channel closed",
    "Connection reset without closing handshake",
    "WebSocket protocol error",
    "WebSocket Error",
)
MAX_CHANNEL_RETRIES = 3


def channel_error_signature(error: BaseException | None) -> str | None:
    if error is None:
        return None
    text = f"{type(error).__name__}: {error}"
    return next((s for s in CHANNEL_ERROR_SIGNATURES if s in text), None)


def sha256_of(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def command(args: list[str], *, timeout: int = 60) -> str:
    result = subprocess.run(
        args, capture_output=True, text=True, encoding="utf-8", cwd=ROOT,
        timeout=timeout, check=False,
    )
    if result.returncode:
        raise RuntimeError(f"命令失败 {args[0]}：{result.stderr or result.stdout}")
    return result.stdout.strip()


class BrowserPhase:
    """单次浏览器会话；命中通道断连签名时由外层丢弃重试。"""

    def __init__(self, workdir: Path, executable: Path) -> None:
        self.workdir = workdir
        workdir.mkdir(parents=True, exist_ok=True)
        self.calls: list[dict[str, Any]] = []
        self.results: dict[str, Any] = {}
        self.args = [
            shutil.which("agent-browser") or "agent-browser",
            "--session",
            f"resilience-full-{uuid.uuid4().hex[:12]}",
            "--json",
            "--executable-path",
            str(executable),
            "--no-webmcp",
        ]

    def browser(self, *params: str, source: str | None = None, timeout: int = 90) -> Any:
        process = subprocess.run(
            [*self.args, *params], input=source, text=True, capture_output=True,
            timeout=timeout, check=False, cwd=ROOT,
        )
        try:
            response = json.loads(process.stdout)
        except json.JSONDecodeError as error:
            raise RuntimeError(
                f"浏览器命令输出不可解析（{params[0]}）：{process.stdout[:500] or process.stderr[:500]}"
            ) from error
        self.calls.append({"args": params, "response": response})
        dump(self.workdir / "browser-commands.json", self.calls)
        if not response.get("success"):
            raise RuntimeError(response.get("error") or f"浏览器命令失败：{params[0]}")
        return response["data"]

    def evaluate(self, source: str, *, timeout: int = 90) -> Any:
        return self.browser("eval", "--stdin", source=source, timeout=timeout)["result"]

    def ready(self, *, timeout_ms: int = 120000) -> None:
        self.browser(
            "wait", "--timeout", str(timeout_ms), "--fn",
            "document.documentElement.dataset.queryState==='ready'",
            timeout=timeout_ms / 1000 + 30,
        )

    def wait_state(self, state: str, *, timeout_ms: int = 120000) -> None:
        self.browser(
            "wait", "--timeout", str(timeout_ms), "--fn",
            f"document.documentElement.dataset.queryState==='{state}'",
            timeout=timeout_ms / 1000 + 30,
        )

    def run(self, name: str, report: Path, script: str, *, query: str = "") -> None:
        self.browser("open", report.as_uri() + query)
        self.ready()
        self.results[name] = self.evaluate(
            (CHECKS / script).read_text(encoding="utf-8"), timeout=240
        )
        if self.results[name].get("result") != "passed":
            raise RuntimeError(f"检查失败：{name}")
        dump(self.workdir / "results.json", self.results)

    def execute(self, report: Path, derived: dict[str, Path], injection: Path, record: Path, manifest: Path) -> None:
        try:
            self.browser("open", "about:blank")
            self.browser("set", "offline", "on")
            self.results["environment"] = self.evaluate(
                "({userAgent:navigator.userAgent,offline:!navigator.onLine})"
            )
            self.run("resilience", report, "check-unified-resilience-full.js")

            # Worker 初始化失败：首次构造抛错，静态兜底可用且明示交互不可用，重试恢复。
            self.browser("open", derived["workerInitFailure"].as_uri())
            self.wait_state("error", timeout_ms=90000)
            self.results["workerInitFailure"] = self.evaluate(
                "({staticRows:document.querySelectorAll('#fallback tbody tr:has(td)').length,"
                "interactive:document.documentElement.classList.contains('interactive-ready'),"
                "retry:!!document.querySelector('[data-action=retry]')})"
            )
            if self.results["workerInitFailure"] != {
                "staticRows": 20, "interactive": False, "retry": True,
            }:
                raise RuntimeError(f"初始化失败断言不匹配：{self.results['workerInitFailure']}")
            self.evaluate("document.querySelector('[data-action=retry]').click()")
            self.ready()
            self.results["workerInitRetry"] = True
            dump(self.workdir / "results.json", self.results)

            # Worker 运行失败：快照操作中崩溃，保留上次成功结果，重试恢复。
            self.browser("open", derived["workerCrash"].as_uri())
            self.ready()
            self.evaluate(
                "window.__crashNext=true;document.querySelector('[data-action=view][data-value=workspace]').click()"
            )
            self.wait_state("error", timeout_ms=120000)
            self.results["workerCrash"] = self.evaluate(
                "({notice:document.querySelector('#query-notice').textContent,"
                "previousVisible:document.documentElement.classList.contains('interactive-ready')})"
            )
            if not (
                self.results["workerCrash"]["previousVisible"]
                and "上次成功结果" in self.results["workerCrash"]["notice"]
            ):
                raise RuntimeError(f"运行失败断言不匹配：{self.results['workerCrash']}")
            self.evaluate("document.querySelector('[data-action=retry]').click()")
            self.ready()
            self.results["workerCrashRetry"] = True
            dump(self.workdir / "results.json", self.results)

            # 指标名称注入：静态与交互两侧均转义，不产生恶意节点。
            self.browser("open", injection.as_uri())
            self.ready()
            self.results["dataInjection"] = self.evaluate(
                "({executed:!!window.__dataInjected,"
                "maliciousNodes:document.querySelectorAll('svg[onload]').length,"
                "name:document.querySelector('[data-overview-metric=code_size] .metric-name').textContent,"
                "staticName:document.querySelector('[data-static-metric=code_size] td').textContent})",
                timeout=120,
            )
            if not (
                not self.results["dataInjection"]["executed"]
                and not self.results["dataInjection"]["maliciousNodes"]
            ):
                raise RuntimeError(f"指标名称注入断言不匹配：{self.results['dataInjection']}")
            if not (
                self.results["dataInjection"]["staticName"]
                == self.results["marker"]
                and self.results["dataInjection"]["name"].startswith(self.results["marker"])
            ):
                raise RuntimeError(f"指标名称原值断言不匹配：{self.results['dataInjection']}")
            dump(self.workdir / "results.json", self.results)

            # 路径／函数名注入：真实二进制打包与 DOM 查询链路。
            root = json.loads(manifest.read_text())["root"]
            injected_path = (
                "/workspace/project/src/bulk/<img src=x onerror=window.__recordInjected=1>.c"
            )
            relative = injected_path.split(root.rstrip("/") + "/", 1)[-1]
            injected_name = "@@DATA@@</script><svg onload=window.__recordInjected=1>"
            record_script = """(async()=>{
          const wait=async()=>{while(document.documentElement.dataset.queryState==='loading')await new Promise(requestAnimationFrame);if(document.documentElement.dataset.queryState!=='ready')throw Error('查询失败');};
          const click=async s=>{document.querySelector(s).click();await wait();};
          await click('[data-action="analysis-type"][data-value="lines_per_method"]');
          await click('[data-action="status"][data-value="all"]');
          const input=document.querySelector('#query-form [name="query"]');input.value=PATH;input.dispatchEvent(new Event('input',{bubbles:true}));await wait();
          return {executed:!!window.__recordInjected,nodes:document.querySelectorAll('img[onerror],svg[onload]').length,found:document.querySelector('.data-table').textContent.includes(NAME),path:document.querySelector('.evidence-panel').textContent.includes(PATH),copy:document.querySelector('#location-text')?.value};
        })()""".replace("NAME", json.dumps(injected_name)).replace("PATH", json.dumps(relative))
            self.browser("open", record.as_uri() + "?view=workspace")
            self.ready()
            self.results["recordInjection"] = self.evaluate(record_script, timeout=240)
            if not (
                not self.results["recordInjection"]["executed"]
                and self.results["recordInjection"]["nodes"] == 0
            ):
                raise RuntimeError(f"路径／名称注入断言不匹配：{self.results['recordInjection']}")
            if not (
                self.results["recordInjection"]["found"]
                and self.results["recordInjection"]["path"]
            ):
                raise RuntimeError(f"注入原值可达断言不匹配：{self.results['recordInjection']}")
            dump(self.workdir / "results.json", self.results)

            # failInit 参数：静态兜底可用且明示交互未启动。
            self.browser("open", report.as_uri() + "?failInit=1")
            self.results["failInit"] = self.evaluate(
                "({rows:document.querySelectorAll('#fallback tbody tr:has(td)').length,"
                "interactive:document.documentElement.classList.contains('interactive-ready'),"
                "status:document.querySelector('#init-status').textContent})"
            )
            if not (
                self.results["failInit"]["rows"] == 20
                and not self.results["failInit"]["interactive"]
            ):
                raise RuntimeError(f"failInit 断言不匹配：{self.results['failInit']}")

            # 删除执行脚本保留数据与 Worker 文本：无 JS 的静态页面可读。
            self.browser("open", derived["scriptsDisabled"].as_uri())
            self.results["scriptsDisabled"] = self.evaluate(
                "({rows:document.querySelectorAll('#fallback tbody tr:has(td)').length,"
                "visible:document.querySelector('#fallback').getBoundingClientRect().height>0,"
                "app:document.querySelector('#app').textContent})"
            )
            if self.results["scriptsDisabled"] != {"rows": 20, "visible": True, "app": ""}:
                raise RuntimeError(f"静态页断言不匹配：{self.results['scriptsDisabled']}")

            self.results["network"] = self.browser("network", "requests")
            if any(
                r.get("url", "").startswith(("http:", "https:"))
                for r in self.results["network"].get("requests", [])
            ):
                raise RuntimeError("断网状态下出现 http(s) 请求")
            self.results["result"] = "passed"
        finally:
            dump(self.workdir / "results.json", self.results)
            try:
                self.browser("close")
            except Exception:
                with open(self.workdir / "close-failed.txt", "a", encoding="utf-8") as log:
                    log.write("会话关闭失败（保留证据）\n")


def write_derived(report: Path, output: Path) -> dict[str, Path]:
    original = report.read_text(encoding="utf-8")
    worker_init = output / "worker-init-failure.html"
    worker_init.write_text(
        original.replace(
            "<head>",
            """<head><script>
          const NativeWorker=Worker;
          window.Worker=class extends NativeWorker {
            constructor(...args){if(!window.__failedOnce){window.__failedOnce=true;throw new Error('独立初始化故障');}super(...args);}
          };
        </script>""",
            1,
        ),
        encoding="utf-8",
    )
    worker_crash = output / "worker-crash.html"
    worker_crash.write_text(
        original.replace(
            "<head>",
            """<head><script>
          const NativeWorker=Worker;
          window.Worker=class extends NativeWorker {
            postMessage(data,...rest){
              if(data.op==='snapshot'&&window.__crashNext){
                window.__crashNext=false;
                setTimeout(()=>this.onerror(new ErrorEvent('error',{message:'独立运行故障'})),0);return;
              }
              super.postMessage(data,...rest);
            }
          };
        </script>""",
            1,
        ),
        encoding="utf-8",
    )
    scripts_disabled = output / "scripts-disabled.html"
    scripts_disabled.write_text(
        re.sub(r"<script>.*?</script>", "", original, flags=re.S), encoding="utf-8"
    )
    return {
        "workerInitFailure": worker_init,
        "workerCrash": worker_crash,
        "scriptsDisabled": scripts_disabled,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir", type=Path,
        default=ROOT / "output/unified-prototype/stage5-inputs/full-mixed",
    )
    parser.add_argument(
        "--report", type=Path,
        default=ROOT / "output/unified-prototype/stage5-final-v1/short/full-mixed/report/cmetrics-prototype.html",
    )
    parser.add_argument("--report-sha256", default=None, help="校验复用 artifact 的 sha256")
    parser.add_argument(
        "--output", type=Path,
        default=ROOT / "output/unified-prototype/stage5-resilience-full-v1",
    )
    parser.add_argument(
        "--browser", type=Path,
        default=Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    )
    parser.add_argument("--skip-builds", action="store_true", help="复用已构建注入 HTML")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    input_dir = args.input_dir.resolve()
    report = args.report.resolve()

    report_sha = sha256_of(report)
    if args.report_sha256 and report_sha != args.report_sha256:
        raise RuntimeError(f"复用 artifact sha256 不匹配：{report_sha}")
    inventory = {
        "inputDir": str(input_dir),
        "report": str(report),
        "reportBytes": report.stat().st_size,
        "reportSha256": report_sha,
        "inputs": {
            side: {
                "bytes": (input_dir / f"{side}.json").stat().st_size,
                "sha256": sha256_of(input_dir / f"{side}.json"),
            }
            for side in ("baseline", "current")
        },
        "gitHead": command(["git", "rev-parse", "HEAD"]),
    }

    marker = '@@DATA@@</script><svg onload="window.__dataInjected=1">&'
    builds: dict[str, Any] = {"marker": marker}
    if not args.skip_builds:
        started = time.perf_counter()
        injection = build_compact_report(
            input_dir, output / "injection",
            ui_meta={"metricNames": {**load_metric_names(), "code_size": marker}},
        )
        builds["metricInjection"] = {
            "path": str(injection), "wallSeconds": round(time.perf_counter() - started, 3),
        }
        if "<td>@@DATA@@&lt;/script&gt;" not in injection.read_text(encoding="utf-8"):
            raise RuntimeError("静态指标名称未按原值转义")

        started = time.perf_counter()
        mutated = output / "record-injection-input"
        mutation = json.loads(
            command(
                ["node", str(CHECKS / "mutate-full-injection.cjs"),
                 str(input_dir), str(mutated)],
                timeout=600,
            )
        )
        builds["recordMutation"] = {
            "summary": mutation, "wallSeconds": round(time.perf_counter() - started, 3),
        }
        started = time.perf_counter()
        record = build_compact_report(mutated, output / "record-injection")
        builds["recordInjection"] = {
            "path": str(record), "wallSeconds": round(time.perf_counter() - started, 3),
        }
    else:
        injection = output / "injection" / "cmetrics-prototype.html"
        record = output / "record-injection" / "cmetrics-prototype.html"
        if not injection.exists() or not record.exists():
            raise RuntimeError("--skip-builds 需要已存在的注入 HTML")
    builds["injectionHtml"] = {"bytes": injection.stat().st_size, "sha256": sha256_of(injection)}
    builds["recordHtml"] = {"bytes": record.stat().st_size, "sha256": sha256_of(record)}
    dump(output / "results.json", {"protocol": PROTOCOL, "inventory": inventory, "builds": builds})

    derived = write_derived(report, output)
    channel_retries: list[dict[str, Any]] = []
    failure: BaseException | None = None
    for attempt in range(1, MAX_CHANNEL_RETRIES + 2):
        workdir = output / "browser"
        phase = BrowserPhase(workdir, args.browser)
        phase.results["marker"] = marker
        try:
            phase.execute(report, derived, injection, record, output / "record-injection-input" / "manifest.json")
            failure = None
            break
        except Exception as error:  # noqa: BLE001 - 需按签名分类后决定重试
            signature = channel_error_signature(error)
            dump(workdir / "results.json", phase.results)
            if signature is None or attempt > MAX_CHANNEL_RETRIES:
                failure = error
                break
            channel_retries.append({
                "attempt": attempt, "errorSignature": signature,
                "error": f"{type(error).__name__}: {error}",
                "discardedEvidencePath": None,
            })
            dump(output / "results.json", {
                "protocol": PROTOCOL, "inventory": inventory, "builds": builds,
                "channelRetries": channel_retries,
            })
            destination = output / "discarded" / f"browser-attempt-{attempt}"
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(workdir), str(destination))
            channel_retries[-1]["discardedEvidencePath"] = str(destination.relative_to(output))
            print(f"DevTools通道断连（{signature}）：丢弃第 {attempt} 次尝试，重试", file=sys.stderr)

    browser_results = json.loads((output / "browser" / "results.json").read_text())
    summary = {
        "protocol": PROTOCOL,
        "command": sys.argv,
        "inventory": inventory,
        "builds": builds,
        "channelRetries": channel_retries,
        "browser": browser_results,
        "fingerprints": [
            fingerprint(p) for p in sorted((ROOT / "prototypes/ui").glob("*")) if p.is_file()
        ],
        "result": browser_results.get("result", "failed"),
    }
    if failure is not None:
        summary["error"] = f"{type(failure).__name__}: {failure}"
    dump(output / "results.json", summary)
    print(json.dumps({
        "result": summary["result"], "output": str(output),
        "error": summary.get("error"),
    }, ensure_ascii=False))
    if failure is not None or summary["result"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
