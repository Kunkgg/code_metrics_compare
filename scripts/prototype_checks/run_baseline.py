"""阶段 0：真实 file:// 回归、容量热查询与干净会话 RSS 基线。

只读取既有报告；构建时间另由构建命令记录。跨平台驱动使用 agent-browser，
RSS 采样使用 psutil。不能用本工具的一次运行宣称全部业务／兼容验收通过。
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import shutil
import statistics
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import psutil

ROOT = Path(__file__).resolve().parents[2]
CHECKS = ROOT / "scripts" / "prototype_checks"


def dump(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fingerprint(path: Path) -> dict[str, Any]:
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"path": str(path.resolve()), "bytes": path.stat().st_size, "sha256": digest}


def command(args: list[str], *, source: str | None = None, timeout: int = 60) -> str:
    result = subprocess.run(
        args,
        input=source,
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=ROOT,
        timeout=timeout,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"命令失败 {args[0]}：{result.stderr or result.stdout}")
    return result.stdout.strip()


class RssSampler:
    """仅采集专用 profile 对应的 Chrome 进程树；报告不完整采样情况。"""

    def __init__(self, profile: Path) -> None:
        self.profile = str(profile)
        self.phase = "blank"
        self.samples: list[dict[str, Any]] = []
        self.started = time.perf_counter()
        self.stop_event = threading.Event()
        self.root: psutil.Process | None = None
        self.thread = threading.Thread(target=self.collect, daemon=True)

    def collect(self) -> None:
        next_sample = time.perf_counter()
        while not self.stop_event.is_set():
            rss = 0
            processes = []
            errors = []
            try:
                if self.root is None:
                    for process in psutil.process_iter(["cmdline"]):
                        args = process.info["cmdline"] or []
                        if f"--user-data-dir={self.profile}" in args and not any(
                            arg.startswith("--type=") for arg in args
                        ):
                            self.root = process
                            break
                if self.root is not None:
                    for process in [self.root, *self.root.children(recursive=True)]:
                        try:
                            amount = process.memory_info().rss
                            rss += amount
                            processes.append({"pid": process.pid, "rssBytes": amount})
                        except psutil.Error as exc:
                            errors.append(type(exc).__name__)
            except psutil.Error as exc:
                errors.append(type(exc).__name__)
            self.samples.append(
                {
                    "elapsedMs": round((time.perf_counter() - self.started) * 1000, 2),
                    "phase": self.phase,
                    "rssBytes": rss,
                    "processes": processes,
                    "errors": errors,
                }
            )
            next_sample += 0.1
            now = time.perf_counter()
            if next_sample < now:
                next_sample = now
            self.stop_event.wait(max(0, next_sample - now))

    def summary(self) -> dict[str, Any]:
        blank = [s["rssBytes"] for s in self.samples if s["phase"] == "blank" and s["processes"]]
        active = [s["rssBytes"] for s in self.samples if s["phase"] != "blank" and s["processes"]]
        baseline = statistics.median(blank[-5:]) if blank else None
        peak = max(active) if active else None
        summary = {
            "sampleIntervalTargetMs": 100,
            "maxObservedIntervalMs": max(
                (
                    b["elapsedMs"] - a["elapsedMs"]
                    for a, b in zip(self.samples, self.samples[1:], strict=False)
                ),
                default=None,
            ),
            "blankSampleCount": len(blank),
            "baselineRssBytes": baseline,
            "peakRssBytes": peak,
            "peakIncrementBytes": max(0, peak - baseline)
            if peak is not None and baseline is not None
            else None,
            "samplingErrorCount": sum(len(s["errors"]) for s in self.samples),
            "limitation": "进程树 RSS 会重复计算共享页；100ms目标间隔可能漏掉瞬时峰值；采样开销未扣除。",
        }
        summary["coverageComplete"] = (
            baseline is not None and peak is not None and not summary["samplingErrorCount"]
        )
        return summary


class Browser:
    def __init__(self, output: Path, executable: Path, *, headed: bool) -> None:
        output.mkdir(parents=True, exist_ok=True)
        self.output = output
        self.calls = 0
        profile = output / "profile"
        self.args = [
            shutil.which("agent-browser") or "agent-browser",
            "--session",
            f"cmetrics-{uuid.uuid4().hex[:12]}",
            "--json",
            "--executable-path",
            str(executable),
            "--profile",
            str(profile),
            "--init-script",
            str(CHECKS / "measure-init.js"),
            "--no-webmcp",
            "--headed",
            "true" if headed else "false",
        ]
        self.sampler = RssSampler(profile)

    def call(self, *args: str, source: str | None = None) -> Any:
        self.calls += 1
        raw = command([*self.args, *args], source=source)
        result = json.loads(raw)
        dump(self.output / "commands" / f"{self.calls:03d}-{args[0]}.json", result)
        if not result.get("success"):
            raise RuntimeError(result.get("error") or f"浏览器命令失败：{args[0]}")
        return result["data"]

    def evaluate(self, source: str) -> Any:
        return self.call("eval", "--stdin", source=source)["result"]

    def start(self) -> dict[str, Any]:
        self.call("open", "about:blank")
        self.sampler.thread.start()
        self.call("set", "viewport", "1440", "1000")
        self.call("set", "offline", "on")
        info = self.evaluate(
            "({userAgent:navigator.userAgent,platform:navigator.platform,offline:!navigator.onLine})"
        )
        for _ in range(20):
            if len([s for s in self.sampler.samples if s["processes"]]) >= 5:
                break
            self.sampler.stop_event.wait(0.1)
        if not any(s["processes"] for s in self.sampler.samples):
            raise RuntimeError("未找到专用浏览器进程，不能登记RSS增量")
        return info

    def open_report(self, report: Path, query: str = "") -> dict[str, Any]:
        self.sampler.phase = "report"
        self.call("open", report.as_uri() + query)
        self.call(
            "wait",
            "--fn",
            "window.__prototypeMeasure?.readyPaintMs !== null && document.documentElement.classList.contains('interactive-ready')",
        )
        return self.evaluate(
            "(async () => ({probe:window.__prototypeMeasure,navigation:performance.getEntriesByType('navigation')[0].toJSON(),browserVersion:navigator.userAgentData ? await navigator.userAgentData.getHighEntropyValues(['fullVersionList']) : null}))()"
        )

    def finish(self) -> dict[str, Any]:
        self.sampler.stop_event.set()
        if self.sampler.thread.is_alive():
            self.sampler.thread.join(timeout=2)
        dump(self.output / "rss-samples.json", self.sampler.samples)
        summary = self.sampler.summary()
        dump(self.output / "rss-summary.json", summary)
        self.call("close")
        return summary


def ui_checks(browser: Browser, report: Path) -> dict[str, Any]:
    results = []
    startup = browser.open_report(report)
    for width in (1440, 390):
        browser.call("set", "viewport", str(width), "1000")
        for filename, view in [
            ("check-overview.js", "overview"),
            ("check-overview-anomalies.js", "overview"),
            ("check-all-metrics.js", "metrics"),
        ]:
            browser.open_report(report, f"?view={view}")
            result = browser.evaluate((CHECKS / filename).read_text(encoding="utf-8"))
            if result.get("result") != "passed":
                raise RuntimeError(f"UI检查失败：{filename}")
            results.append({"script": filename, "width": width, **result})
    browser.call("screenshot", str(browser.output / "ui-metrics.png"))
    clean_errors = browser.call("errors")
    network = browser.call("network", "requests")
    if clean_errors.get("errors") or any(
        r.get("url", "").startswith(("http:", "https:")) for r in network.get("requests", [])
    ):
        raise RuntimeError("正常UI检查存在页面错误或外连请求，详见原始命令记录")
    browser.call("open", report.as_uri() + "?failInit=1")
    failure = browser.evaluate(
        "({ready:document.documentElement.classList.contains('interactive-ready'),text:document.querySelector('#init-status').textContent,metrics:document.querySelectorAll('#fallback tbody tr:has(td)').length})"
    )
    if failure["ready"] or failure["metrics"] != 20 or "交互不可用" not in failure["text"]:
        raise RuntimeError(f"初始化失败兜底不符：{failure}")
    return {
        "startup": startup,
        "checks": results,
        "normalPageErrors": clean_errors,
        "network": network,
        "initializationFailure": failure,
    }


def unified_checks(browser: Browser, report: Path, samples: int, *, full: bool) -> dict[str, Any]:
    result: dict[str, Any] = {"startup": browser.open_report(report)}
    if full:
        checks = []
        for width in (1440, 390):
            browser.call("set", "viewport", str(width), "1000")
            browser.open_report(report)
            checked = browser.evaluate(
                (CHECKS / "check-unified-files.js").read_text(encoding="utf-8")
            )
            if checked.get("result") != "passed":
                raise RuntimeError(f"统一UI检查失败：{checked}")
            checks.append(checked)
            browser.call("screenshot", str(browser.output / f"unified-{width}.png"))
        result["checks"] = checks
        browser.call("set", "viewport", "1440", "1000")
        browser.open_report(report, "?view=workspace")
        code = """(async()=>{
          const wait=async()=>{
            const deadline=performance.now()+15000;
            while(document.documentElement.dataset.queryState==='loading'){
              if(performance.now()>deadline)throw new Error('查询超时');
              await new Promise(requestAnimationFrame);
            }
            if(document.documentElement.dataset.queryState!=='ready')throw new Error('查询失败');
            await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
          };
          document.querySelector('[data-action="status"][data-value="all"]').click();await wait();
          const tasks=[];
          for(const task of ['file-sort-change','global-path-search','deep-page']){
            const values=[];
            for(let i=0;i<TIMES+1;i++){
              const started=performance.now();
              if(task==='file-sort-change')document.querySelector('[data-action="sort"][data-value="c"]').click();
              if(task==='global-path-search'){
                const input=document.querySelector('#query-form [name="query"]');
                input.value=i%2?'src':'src/';input.dispatchEvent(new Event('input',{bubbles:true}));
              }
              if(task==='deep-page'){
                const input=document.querySelector('.table-panel .page-jump');
                input.value=i%2?input.max:Math.min(51,Number(input.max));input.dispatchEvent(new Event('change',{bubbles:true}));
              }
              await wait();
              const elapsedMs=performance.now()-started,state=JSON.parse(document.querySelector('.state-inspector pre').textContent);
              const ids=[...document.querySelectorAll('.data-table [data-action="select"]')].map(r=>r.dataset.value);
              if(!state.result||ids.length!==Math.min(state.pageSize,state.result-(state.page-1)*state.pageSize))throw new Error('查询为空或当前页不完整');
              values.push({elapsedMs,total:state.result,page:state.page,sort:state.sort,search:state.query,ids});
            }
            tasks.push({name:task,warmup:values.shift(),samples:values});
            const clear=document.querySelector('[data-action="clear-search"]');if(clear){clear.click();await wait();}
          }
          return tasks;
        })()""".replace("TIMES", str(samples))
        browser.sampler.phase = "unified-interactions"
        result["tasks"] = browser.evaluate(code)
        for task in result["tasks"]:
            ordered = sorted(item["elapsedMs"] for item in task["samples"])
            task["p95Ms"] = ordered[math.ceil(0.95 * len(ordered)) - 1]
        result["normalPageErrors"] = browser.call("errors")
        result["network"] = browser.call("network", "requests")
        if result["normalPageErrors"].get("errors") or any(
            request.get("url", "").startswith(("http:", "https:"))
            for request in result["network"].get("requests", [])
        ):
            raise RuntimeError("统一UI正常任务存在脚本错误或外连请求")
        browser.call("open", report.as_uri() + "?failInit=1")
        fallback = browser.evaluate(
            "({ready:document.documentElement.classList.contains('interactive-ready'),metrics:document.querySelectorAll('#fallback tbody tr:has(td)').length})"
        )
        if fallback != {"ready": False, "metrics": 20}:
            raise RuntimeError(f"静态兜底失败：{fallback}")
        result["initializationFailure"] = fallback
    return result


def capacity_checks(
    browser: Browser, report: Path, samples: int, *, full: bool, expect: str
) -> dict[str, Any]:
    startup = browser.open_report(report)
    result: dict[str, Any] = {"startup": startup}
    directory = browser.evaluate(
        "JSON.parse(document.querySelector('#scale-meta').textContent).scale.shape === 'wide' ? 'src/wide' : 'src/bulk'"
    )
    tasks = [
        ("files-first", {"type": "files", "status": "all", "sort": "delta-desc"}),
        ("methods-first", {"type": "methods", "status": "all", "sort": "delta-desc"}),
        ("files-path-search", {"type": "files", "status": "all", "search": "unit_000"}),
        ("directory-files", {"type": "files", "status": "all", "directory": directory}),
    ]
    if expect == "fixed":
        tasks.insert(2, ("methods-sort-change", {"type": "methods", "status": "all"}))
    first = browser.evaluate(
        "window.scalePrototype.run('query',{type:'files',status:'all',directory:'',search:'',page:1,pageSize:50,sort:'path-asc'})"
    )
    result["firstQuery"] = first
    result["initialization"] = browser.evaluate("window.scalePrototype.metrics.init")
    if full:
        result["existingVerify26"] = browser.evaluate("window.scalePrototype.run('verify')")
        result["tasks"] = []
        for name, patch in tasks:
            query = {
                "directory": "",
                "search": "",
                "metric": "lines",
                "page": 1,
                "pageSize": 50,
                "sort": "path-asc",
                **patch,
            }
            # 每任务一轮预热独立保存；不调用会强制首页且只返回摘要的旧 bench()。
            browser.sampler.phase = f"warmup:{name}"
            warmup = browser.evaluate(f"window.scalePrototype.run('query',{json.dumps(query)})")
            browser.sampler.phase = f"hot:{name}"
            code = (
                """(async () => {
              const samples=[];
              for(let i=0;i<TIMES;i++) {
                const query={...QUERY};
                if(ALTERNATE)query.sort=i%2?'delta-desc':'delta-asc';
                const result=await window.scalePrototype.run('query',query);
                const ids=[...document.querySelectorAll('#table-region tbody tr[data-action="select"]')].map(r=>r.dataset.value);
                samples.push({...result,sort:query.sort,ids});
              }
              return samples;
            })()""".replace("TIMES", str(samples))
                .replace("QUERY", json.dumps(query))
                .replace("ALTERNATE", json.dumps(name == "methods-sort-change"))
            )
            values = browser.evaluate(code)
            elapsed = sorted(s["elapsedMs"] for s in values)
            counts_ok = all(len(s["ids"]) == min(50, s["total"]) for s in values)
            stable = all(
                (s["total"], s["ids"])
                == (
                    values[i % 2 if name == "methods-sort-change" else 0]["total"],
                    values[i % 2 if name == "methods-sort-change" else 0]["ids"],
                )
                for i, s in enumerate(values)
            )
            result["tasks"].append(
                {
                    "name": name,
                    "cacheMode": "每次切换排序并重新计算"
                    if name == "methods-sort-change"
                    else "固定条件重复查询；预热单列",
                    "hasCandidates": values[0]["total"] > 0,
                    "query": query,
                    "warmup": warmup,
                    "samples": values,
                    "p95Ms": elapsed[math.ceil(0.95 * len(elapsed)) - 1],
                    "renderedCountCorrect": counts_ok,
                    "repeatResultsStable": stable,
                    "coverage": "现有容量页首页热查询；仅验证显示数量和重复结果，不代表独立全量排序正确性",
                }
            )
            if not counts_ok or not stable or values[0]["total"] == 0:
                raise RuntimeError(f"容量基线任务为空或结果不稳定：{name}")
        browser.sampler.phase = "deep-pages"
        page_size = 50 if first["total"] > 2500 else 1
        deep = browser.evaluate(
            f"window.scalePrototype.run('query',{{type:'files',status:'all',directory:'',search:'',page:51,pageSize:{page_size},sort:'path-asc'}})"
        )
        ids_code = "[...document.querySelectorAll('#table-region tbody tr[data-action=\"select\"]')].map(r=>r.dataset.value)"
        ids = browser.evaluate(ids_code)
        expected_ids = [
            f"f:{i}" for i in range(50 * page_size, min(51 * page_size, first["total"]))
        ]
        result["page51"] = {
            **deep,
            "ids": ids,
            "expectedIds": expected_ids,
            "renderedRows": len(ids),
            "expectedRows": len(expected_ids),
            "status": "pass" if ids == expected_ids else "known-failure" if not ids else "fail",
        }
        if (expect == "known-defects" and ids) or (expect == "fixed" and ids != expected_ids):
            raise RuntimeError("第51页与所选验收预期不符")
        if expect == "fixed":
            last_page = math.ceil(first["total"] / page_size)
            last = browser.evaluate(f"window.scalePrototype.run('query',{{page:{last_page}}})")
            last_ids = browser.evaluate(ids_code)
            expected_last = [f"f:{i}" for i in range((last_page - 1) * page_size, first["total"])]
            result["lastPage"] = {**last, "ids": last_ids, "expectedIds": expected_last}
            if last_ids != expected_last:
                raise RuntimeError("末页文件不完整或排序不符")
            browser.sampler.phase = "request-order"
            race = browser.evaluate("""(async()=>{
              const api=window.scalePrototype;
              const old=api.run('query',{search:'unit_000',page:1});
              const current=api.run('query',{search:'__cmetrics_absent_7fa94__',page:1});
              const responses=await Promise.all([old,current]);
              const empty={rows:document.querySelectorAll('#table-region tbody tr[data-action="select"]').length,disabled:[...document.querySelectorAll('#table-region [data-action="page"]')].every(b=>b.disabled)};
              const leaving=api.run('query',{search:'',page:1});
              await api.run('view',{view:'overview'});
              const abandoned=await leaving;
              for(let i=0;api.busy&&i<120;i++)await new Promise(requestAnimationFrame);
              return {responses,empty,leaving:abandoned,view:api.state.view,busy:api.busy};
            })()""")
            result["requestOrder"] = race
            if not (
                race["responses"][0]["status"] == "cancelled"
                and race["responses"][1]["status"] == "complete"
                and race["responses"][1]["total"] == 0
                and race["empty"] == {"rows": 0, "disabled": True}
                and race["leaving"]["status"] == "cancelled"
                and race["view"] == "overview"
                and not race["busy"]
            ):
                raise RuntimeError(f"异步查询、空结果或切页状态不符：{race}")
        browser.call("screenshot", str(browser.output / "capacity-final.png"))
    result["probe"] = browser.evaluate("window.__prototypeMeasure")
    result["errors"] = browser.call("errors")
    result["network"] = browser.call("network", "requests")
    if result["errors"].get("errors") or result["probe"]["errors"]:
        raise RuntimeError("容量页面出现脚本错误，详见原始命令记录")
    if any(
        r.get("url", "").startswith(("http:", "https:"))
        for r in result["network"].get("requests", [])
    ):
        raise RuntimeError("容量页面存在外连请求，详见原始命令记录")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ui-report", type=Path)
    parser.add_argument("--unified-report", type=Path, action="append", default=[])
    parser.add_argument("--capacity-report", type=Path, action="append", default=[])
    parser.add_argument(
        "--input-dir",
        type=Path,
        action="append",
        default=[],
        help="额外登记原始输入摘要，不复制压力数据",
    )
    parser.add_argument(
        "--browser", type=Path, required=True, help="明确选择 Chrome 或 Edge 可执行文件"
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--startup-runs", type=int, default=3)
    parser.add_argument("--headed", action="store_true")
    parser.add_argument(
        "--capacity-expect", choices=["known-defects", "fixed"], default="known-defects"
    )
    args = parser.parse_args()
    if (
        args.samples < 1
        or args.startup_runs < 1
        or not (args.ui_report or args.capacity_report or args.unified_report)
    ):
        parser.error("至少指定一份报告；samples 和 startup-runs 必须为正数")
    output = args.output_dir.resolve()
    if (output / "results.json").exists():
        parser.error("输出目录已有测量记录，请使用新目录保留历史证据")
    output.mkdir(parents=True, exist_ok=True)
    artifacts = [
        p.resolve()
        for p in ([args.ui_report] if args.ui_report else [])
        + args.capacity_report
        + args.unified_report
    ]
    sources = sorted(
        [
            *(ROOT / "prototypes").rglob("*.py"),
            *(ROOT / "prototypes").rglob("*.js"),
            *(ROOT / "prototypes").rglob("*.html"),
            *(ROOT / "prototypes").rglob("*.css"),
            *CHECKS.glob("*.py"),
            *CHECKS.glob("*.js"),
            *CHECKS.glob("*.cjs"),
        ]
    )
    inputs = sorted(
        {
            directory / name
            for directory in {
                *(p.parent for p in artifacts),
                *(p.resolve() for p in args.input_dir),
            }
            for name in ("baseline.json", "current.json", "manifest.json")
            if (directory / name).is_file()
        }
    )
    report: dict[str, Any] = {
        "protocol": "prototype-baseline-1",
        "command": sys.argv,
        "environment": {
            "os": platform.platform(),
            "python": sys.version,
            "machine": platform.machine(),
            "cpu": command(["sysctl", "-n", "machdep.cpu.brand_string"])
            if sys.platform == "darwin"
            else platform.processor(),
            "logicalCpus": psutil.cpu_count(),
            "physicalMemoryBytes": psutil.virtual_memory().total,
            "browserExecutable": str(args.browser.resolve()),
            "headed": args.headed,
            "node": command(["node", "--version"]),
            "uv": command(["uv", "--version"]),
            "agentBrowser": command(["agent-browser", "--version"]),
            "dependencies": {
                name: importlib.metadata.version(name)
                for name in ("psutil", "polars", "msgspec", "jsonschema", "pytest")
            },
        },
        "git": {
            "head": command(["git", "rev-parse", "HEAD"]),
            "status": command(["git", "status", "--short"]),
        },
        "artifacts": [fingerprint(p) for p in artifacts],
        "inputs": [fingerprint(p) for p in inputs],
        "sources": [fingerprint(p) for p in sources],
        "lock": fingerprint(ROOT / "uv.lock"),
        "requirements": {
            "requiredFilesPerSide": 100000,
            "requiredMethodsPerSide": 1000000,
            "explorationFilesPerSide": 200000,
            "windowsRequired": True,
        },
        "limitations": [
            "现有UI与容量查询实验；不是统一原型最终验收",
            "干净profile重复启动；未清操作系统磁盘缓存",
            "首轮查询独立记录，未覆盖每类冷查询20次",
            "RSS采样有共享页重计与漏采限制",
            "未测试的平台不列入通过范围",
            "物理磁盘型号与SSD条件需在验收设备登记",
        ],
        "runs": [],
    }
    dump(output / "results.json", report)
    jobs = []
    if args.ui_report:
        jobs.append(("ui", args.ui_report.resolve(), 0))
    for index, artifact in enumerate(args.capacity_report):
        jobs.extend(
            (f"capacity-{index}-{artifact.parent.name}", artifact.resolve(), run)
            for run in range(args.startup_runs)
        )
    for index, artifact in enumerate(args.unified_report):
        jobs.extend(
            (f"unified-{index}-{artifact.parent.name}", artifact.resolve(), run)
            for run in range(args.startup_runs)
        )
    failed = False
    for label, artifact, run in jobs:
        print(f"开始 {label} 第 {run + 1} 次", flush=True)
        browser = Browser(output / f"{label}-{run + 1}", args.browser.resolve(), headed=args.headed)
        entry: dict[str, Any] = {"label": label, "run": run + 1, "artifact": str(artifact)}
        report["runs"].append(entry)
        try:
            entry["browser"] = browser.start()
            entry["result"] = (
                ui_checks(browser, artifact)
                if label == "ui"
                else unified_checks(browser, artifact, args.samples, full=run == 0)
                if label.startswith("unified-")
                else capacity_checks(
                    browser, artifact, args.samples, full=run == 0, expect=args.capacity_expect
                )
            )
            entry["status"] = (
                "completed-with-known-defects"
                if label.startswith("capacity-")
                and run == 0
                and args.capacity_expect == "known-defects"
                else "completed"
            )
        except Exception as exc:
            entry["status"] = "failed"
            entry["error"] = str(exc)
            failed = True
        finally:
            try:
                entry["memory"] = browser.finish()
            except Exception as exc:
                entry["cleanupError"] = str(exc)
                failed = True
            dump(output / "results.json", report)
        print(f"完成 {label}：{entry['status']}", flush=True)
    print(f"结果：{output / 'results.json'}", flush=True)
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
