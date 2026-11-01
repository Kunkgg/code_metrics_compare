"""阶段5容量测量：独立冷会话、真实UI任务、完整进程树RSS和长时样本。

默认20次冷会话和每任务20次热样本；减小参数只用于校准，不能作为验收。
输入和报告只读，产物仅写新建的 output/unified-prototype 子目录。
"""

from __future__ import annotations

import argparse
import contextlib
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

from scripts.prototype_checks.run_baseline import (
    ROOT,
    Browser,
    command,
    dump,
    fingerprint,
)

# 变化率、存续修改、集合进出和保留率独立登记；大集合进出不替代100%存续修改。
MATRIX = [
    {"name": f"{label}-{shape}", "files": 100000, "change": rate, "shape": shape, "churn": 0}
    for label, rate in (("low", 0.01), ("mid", 0.3), ("full", 1.0))
    for shape in ("mixed", "wide", "deep")
] + [
    {"name": "churn-mixed", "files": 100000, "change": 1.0, "shape": "mixed", "churn": 0.2},
    {"name": "200k-explore", "files": 200000, "change": 1.0, "shape": "mixed", "churn": 0.02},
]


class TreeSampler:
    """从明确根PID或专用profile发现根进程；逐样本递归采集全部后代。"""

    def __init__(self, *, profile: Path | None = None, pid: int | None = None) -> None:
        self.profile = str(profile) if profile else None
        self.root = psutil.Process(pid) if pid else None
        self.phase = "blank"
        self.started = time.perf_counter()
        self.samples: list[dict[str, Any]] = []
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.collect, daemon=True)

    def collect(self) -> None:
        while not self.stop_event.is_set():
            tick = time.perf_counter()
            processes, errors = [], []
            try:
                if self.root is None:
                    for process in psutil.process_iter(["cmdline"]):
                        args = process.info["cmdline"] or []
                        if f"--user-data-dir={self.profile}" in args and not any(
                            arg.startswith("--type=") for arg in args
                        ):
                            self.root = process
                            break
                if self.root:
                    for process in [self.root, *self.root.children(recursive=True)]:
                        try:
                            with process.oneshot():
                                processes.append(
                                    {
                                        "pid": process.pid,
                                        "ppid": process.ppid(),
                                        "name": process.name(),
                                        "created": process.create_time(),
                                        "rssBytes": process.memory_info().rss,
                                    }
                                )
                        except psutil.Error as exc:
                            errors.append({"pid": process.pid, "error": type(exc).__name__})
            except psutil.Error as exc:
                errors.append({"error": type(exc).__name__})
            self.samples.append(
                {
                    "elapsedMs": (tick - self.started) * 1000,
                    "phase": self.phase,
                    "rssBytes": sum(p["rssBytes"] for p in processes),
                    "processes": processes,
                    "errors": errors,
                }
            )
            self.stop_event.wait(max(0, 0.1 - (time.perf_counter() - tick)))

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread.is_alive():
            self.thread.join(timeout=3)

    def summary(self) -> dict[str, Any]:
        valid = [s for s in self.samples if s["processes"]]
        blank = [s["rssBytes"] for s in valid if s["phase"] == "blank"]
        active = [s["rssBytes"] for s in valid if s["phase"] != "blank"]
        baseline = statistics.median(blank[-5:]) if blank else None
        peak = max(active, default=None)
        return {
            "sampleIntervalTargetMs": 100,
            "maxObservedIntervalMs": max(
                (
                    b["elapsedMs"] - a["elapsedMs"]
                    for a, b in zip(self.samples, self.samples[1:], strict=False)
                ),
                default=None,
            ),
            "baselineRssBytes": baseline,
            "peakRssBytes": peak,
            "peakIncrementBytes": peak - baseline
            if peak is not None and baseline is not None
            else None,
            "samplingErrorCount": sum(len(s["errors"]) for s in self.samples),
            "coverageComplete": baseline is not None
            and peak is not None
            and not any(s["errors"] for s in self.samples),
            "maxProcesses": max((len(s["processes"]) for s in valid), default=0),
            "coverage": "每次采样根进程及递归后代；共享页重计，进程枚举存在竞态，100ms之间的峰值可能漏采",
        }


class CapacityBrowser(Browser):
    def __init__(self, output: Path, executable: Path, *, headed: bool) -> None:
        super().__init__(output, executable, headed=headed)
        self.args[self.args.index("--session") + 1] = f"capacity-{uuid.uuid4().hex[:12]}"
        self.sampler = TreeSampler(profile=output / "profile")


# agent-browser daemon与Chrome DevTools间的WebSocket通道偶发被对端reset（约每冷会话4-7%，
# 页面与浏览器进程树本身存活；判定见output/unified-prototype/stage5-cdp-repro/verdict.md）。
# CLI把该断连暴露为下列错误文本；命中签名的失败会话整体丢弃，以新profile重建重跑。
CHANNEL_ERROR_SIGNATURES = (
    "CDP response channel closed",
    "Connection reset without closing handshake",
    "WebSocket protocol error",
    "WebSocket Error",
)
MAX_CHANNEL_RETRIES = 3


def channel_error_signature(error: BaseException | None) -> str | None:
    """异常文本命中DevTools通道断开签名时返回该签名文本，否则返回None。"""
    if error is None:
        return None
    text = f"{type(error).__name__}: {error}"
    return next((s for s in CHANNEL_ERROR_SIGNATURES if s in text), None)


def discard_session(browser: CapacityBrowser, attempt: int) -> str:
    """尽力关闭残留浏览器会话；被弃会话产物整体移入discarded/子目录保留，返回相对路径。"""
    try:
        browser.call("close")
    except Exception:
        with contextlib.suppress(Exception):
            command([*browser.args, "close"])
    destination = browser.output.parent / "discarded" / f"{browser.output.name}-attempt-{attempt}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(browser.output), str(destination))
    return str(destination.relative_to(browser.output.parent))


# 所有操作都走真实DOM事件；重选当前指标会直接返回，故每次先切到另一指标。
# 计时从请求事件开始，到DOM提交后再等两帧；不调用旧bench和容量首页摘要接口。
TASK_JS = r"""(async()=>{
 const cfg=CONFIG;
 const state=()=>JSON.parse(document.querySelector('.state-inspector pre').textContent);
 const settle=async()=>{
   const start=performance.now();
   while(document.documentElement.dataset.queryState==='loading'){
     if(performance.now()-start>45000)throw Error('查询超时');
     await new Promise(requestAnimationFrame);
   }
   if(document.documentElement.dataset.queryState!=='ready')throw Error('查询未就绪');
   await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
 };
 const click=async(action,value)=>{
   const node=[...document.querySelectorAll('[data-action]')].find(n=>n.dataset.action===action&&n.dataset.value===value);
   if(!node)throw Error('控件缺失 '+action+':'+value);
   node.click();await settle();
 };
 await click('view','workspace');
 const metrics=[...document.querySelectorAll('[data-action="analysis-type"]')].map(n=>n.dataset.value);
 const results=[];
 const queryState=s=>Object.fromEntries(['scenario','type','metric','directory','exactFile','searchScope','status','sort','query','numberFilter'].map(key=>[key,s[key]]));
 for(const metric of metrics){
   await click('analysis-type',metric==='code_size'?'lines_per_file':'code_size');
   const start=performance.now();await click('analysis-type',metric);
   const elapsedMs=performance.now()-start,s=state();
   const ids=[...document.querySelectorAll('.data-table [data-action="select"]')].map(n=>n.dataset.value);
   if(s.metric!==metric||ids.length!==Math.min(s.pageSize,s.result))throw Error('指标状态或首页数量不完整 '+metric);
   results.push({task:'metric:'+metric,elapsedMs,total:s.result,page:s.page,ids,state:queryState(s),validated:'待独立完整业务序列与同一查询状态核对'});
 }
 await click('analysis-type','code_size');await click('status','all');
 // 使用路径升序，独立原始输入预期可精确核对首/51/末页及全范围搜索。
 const sort=async()=>{for(let i=0;state().sort!=='path:asc'&&i<3;i++)await click('sort','path');};
 await sort();
 for(const task of ['files-first','files-page51','files-last','files-search']){
   const input=document.querySelector('#query-form [name="query"]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));await settle();
   if(state().page!==1){const p=document.querySelector('.table-panel .page-jump');p.value=1;p.dispatchEvent(new Event('change',{bubbles:true}));await settle();}
   const start=performance.now();
   if(task==='files-search'){
     const q=document.querySelector('#query-form [name="query"]');q.value='unit_000';q.dispatchEvent(new Event('input',{bubbles:true}));
   }else{
     const p=document.querySelector('.table-panel .page-jump');p.value=task==='files-page51'?Math.min(51,Number(p.max)):task==='files-last'?p.max:1;
     p.dispatchEvent(new Event('change',{bubbles:true}));
   }
   await settle();const elapsedMs=performance.now()-start,s=state();
   const ids=[...document.querySelectorAll('.data-table [data-action="select"]')].map(n=>n.dataset.value);
   const expected=cfg.files.filter(p=>task!=='files-search'||p.includes('unit_000'));
   const wanted=expected.slice((s.page-1)*s.pageSize,s.page*s.pageSize).map(p=>'file:'+p);
   const targetPage=!expected.length?0:task==='files-page51'?Math.min(51,Math.ceil(expected.length/s.pageSize)):task==='files-last'?Math.ceil(expected.length/s.pageSize):1;
   const valid=s.result===expected.length&&s.page===targetPage&&s.sort==='path:asc'&&JSON.stringify(ids)===JSON.stringify(wanted);
   results.push({task,elapsedMs,total:s.result,page:s.page,ids,state:queryState(s),valid,expectedTotal:expected.length});
   if(!valid)throw Error('独立文件查询预期失败 '+task+' '+JSON.stringify(results.at(-1)));
 }
 await click('analysis-type','lines_per_method');await click('status','all');await sort();
 for(const task of ['methods-page51','methods-last','methods-name','methods-absent']){
   const q=document.querySelector('#query-form [name="query"]');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}));await settle();
   const start=performance.now();
   if(task.startsWith('methods-p')||task==='methods-last'){
     const page=document.querySelector('.table-panel .page-jump');page.value=task==='methods-last'?page.max:Math.min(51,Number(page.max));page.dispatchEvent(new Event('change',{bubbles:true}));
   }else{const input=document.querySelector('#query-form [name="query"]');input.value=task==='methods-name'?cfg.methodName:'__absent_method_992451__';input.dispatchEvent(new Event('input',{bubbles:true}));}
   await settle();const elapsedMs=performance.now()-start,s=state();
   const ids=[...document.querySelectorAll('.data-table [data-action="select"]')].map(n=>n.dataset.value);
   if(task==='methods-name'&&!s.result)throw Error('真实函数名称搜索为空');
   if(task==='methods-absent'&&s.result)throw Error('不存在名称未返回空');
   results.push({task,elapsedMs,total:s.result,page:s.page,ids,state:queryState(s),validated:'待独立完整业务序列与同一查询状态核对'});
 }
 // 数值筛选的计时从提交开始，编辑表单不计入查询时间。
 const clear=document.querySelector('[data-action="clear-search"]');if(clear){clear.click();await settle();}
 await click('edit-number',undefined);
 const form=document.querySelector('#number-form');form.elements.field.value='c';form.elements.operator.value='gte';form.elements.value.value='100';
 const numberStart=performance.now();form.requestSubmit();await settle();
 const numberState=state();results.push({task:'methods-number',elapsedMs:performance.now()-numberStart,total:numberState.result,page:numberState.page,state:queryState(numberState),validated:'待独立完整业务序列与同一查询状态核对'});
 return results;
})()"""


def file_oracle(input_dir: Path) -> tuple[list[str], dict[str, Any]]:
    """逐侧读取，独立检查文件数和代码行；函数数另从真实明细计数。"""
    manifest = json.loads((input_dir / "manifest.json").read_text())
    paths: set[str] = set()
    actual = {}
    for side in ("baseline", "current"):
        report = json.loads((input_dir / f"{side}.json").read_bytes())
        detail = report["detail_metrics"]
        files = detail["file_sizes"]
        methods = detail["method_metrics"]
        # 生成器的末项是最大复杂度汇总，不是普通函数。
        count = sum("file_name" in method and "method_name" in method for method in methods)
        actual[side] = {
            "files": len(files),
            "methods": count,
            "sampleMethodName": methods[0]["method_name"],
            "codeLines": sum(v[0] for v in files.values()),
        }
        paths.update(p.removeprefix(manifest["root"] + "/") for p in files)
        del report, detail, files, methods
    return sorted(paths), {
        "manifest": manifest,
        "actual": actual,
        "requiredScaleMet": all(
            v["files"] >= 100000 and v["methods"] >= 1000000 and v["codeLines"] >= 25000000
            for v in actual.values()
        ),
    }


def build(input_dir: Path, output: Path) -> dict[str, Any]:
    """独立子进程构建，完整进程树采样；不把生成输入或校验耗时混入打包。"""
    args = [
        sys.executable,
        "-m",
        "prototypes.ui.prototype",
        "--input-dir",
        str(input_dir),
        "--output-dir",
        str(output),
    ]
    started = time.perf_counter()
    with (output.parent / "build.log").open("w") as log:
        process = subprocess.Popen(args, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        sampler = TreeSampler(pid=process.pid)
        sampler.phase = "build"
        sampler.thread.start()
        try:
            code = process.wait(timeout=1200)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            sampler.stop()
            dump(output.parent / "build-rss.json", sampler.samples)
    result = {
        "command": args,
        "returncode": code,
        "wallSeconds": time.perf_counter() - started,
        "memory": sampler.summary(),
        "includesFullValidation": False,
    }
    dump(output.parent / "build.json", result)
    if code:
        raise RuntimeError("紧凑报告构建失败，见build.log")
    return result


def summaries(runs: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for run in runs:
        for batch in run.get(mode, []):
            for sample in batch:
                groups.setdefault(sample["task"], []).append(sample)
    return [
        {
            "task": task,
            "count": len(values),
            "p95Ms": sorted(v["elapsedMs"] for v in values)[math.ceil(0.95 * len(values)) - 1]
            if len(values) >= 20
            else None,
            "observedMinMs": min(v["elapsedMs"] for v in values),
            "observedMaxMs": max(v["elapsedMs"] for v in values),
            "independentlyValidated": all(v.get("valid", False) for v in values),
            "correctnessCoverage": "原始输入完整文件路径并集：总数、页码、排序、当前页全部ID；未核验业务值"
            if task.startswith("files-")
            else "仅指标状态及当前页数量；待独立完整业务序列核验",
            "performanceGroup": "independently-checked-file-tasks"
            if task.startswith("files-")
            else "metrics-awaiting-independent-full-sequence",
            "performanceAcceptance": "文件任务结果核验完成；仍待足量样本、源码冻结与完整矩阵"
            if task.startswith("files-") and all(v.get("valid", False) for v in values)
            else "指标业务序列未独立核验；即使P95达标也不计性能通过",
        }
        for task, values in groups.items()
    ]


def enforce_browser_limits(browser: CapacityBrowser, run: dict[str, Any], mode: str) -> None:
    """记录已观察的超限；不把仅时延指标升级为独立正确性通过。"""
    failures = []
    memory = browser.sampler.summary()
    if (memory.get("peakIncrementBytes") or 0) > 2 * 1024**3:
        failures.append(
            {
                "kind": "browser-rss-increment",
                "observedBytes": memory["peakIncrementBytes"],
                "limitBytes": 2 * 1024**3,
            }
        )
    for task in summaries([run], mode):
        if task["p95Ms"] is not None and task["p95Ms"] > 1000:
            failures.append(
                {
                    "kind": "interaction-p95",
                    "mode": mode,
                    "task": task["task"],
                    "observedMs": task["p95Ms"],
                    "limitMs": 1000,
                    "correctnessCoverage": task["correctnessCoverage"],
                }
            )
    if failures:
        run.setdefault("thresholdFailures", []).extend(failures)
        raise RuntimeError("已观察到容量门槛超限；停止本组并保留逐次样本")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--report", type=Path, help="复用HTML；省略则在新产物目录实际构建")
    parser.add_argument("--browser", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--cold-runs", type=int, default=20)
    parser.add_argument("--hot-samples", type=int, default=20)
    parser.add_argument("--soak-seconds", type=float, default=1800)
    parser.add_argument("--headed", action="store_true")
    parser.add_argument(
        "--browser-release-file",
        type=Path,
        help="构建后等待该文件出现才开始浏览器；用于隔离并行检查",
    )
    parser.add_argument(
        "--matrix", action="store_true", help="只打印生成及冻结后测量计划，不构建或启动浏览器"
    )
    parser.add_argument(
        "--matrix-input-root", type=Path, default=Path("output/unified-prototype/stage5-inputs")
    )
    args = parser.parse_args()
    if args.matrix:
        plan = []
        for config in MATRIX:
            row = dict(config)
            input_dir = args.matrix_input_root / row["name"]
            row["inputDirectory"] = str(input_dir)
            row["inputPresent"] = all(
                (input_dir / name).is_file()
                for name in ("baseline.json", "current.json", "manifest.json")
            )
            row["role"] = (
                "exploration-deferred" if row["files"] == 200000 else "required-100k-matrix"
            )
            row["requiresSourceFreeze"] = True
            row["generationAction"] = (
                "reuse-existing-and-verify" if row["inputPresent"] else "generate-new"
            )
            row["command"] = (
                [
                    "uv",
                    "run",
                    "python",
                    "-m",
                    "scripts.prototype_scale_data",
                    "--num-files",
                    str(row["files"]),
                    "--change-rate",
                    str(row["change"]),
                    "--shape",
                    row["shape"],
                    "--churn-rate",
                    str(row["churn"]),
                    "--output-dir",
                    str(input_dir),
                ]
                if not row["inputPresent"]
                else None
            )
            # 只有100%-mixed安排30分钟长时，其余组保留20冷/20热，避免重复30分钟工作。
            row["measurementAfterFreeze"] = [
                "uv",
                "run",
                "python",
                "-m",
                "scripts.prototype_checks.measure_unified_capacity",
                "--input-dir",
                str(input_dir),
                "--browser",
                str(args.browser) if args.browser else "<当地Chrome或Edge可执行文件>",
                "--output-dir",
                str(
                    (args.output_dir or Path("output/unified-prototype/stage5-frozen-matrix"))
                    / row["name"]
                ),
                "--cold-runs",
                "20",
                "--hot-samples",
                "20",
                "--soak-seconds",
                "1800" if row["name"] == "full-mixed" else "0",
            ]
            if args.headed:
                row["measurementAfterFreeze"].append("--headed")
            plan.append(row)
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return
    if not args.input_dir or not args.browser or not args.output_dir:
        parser.error("必须指定input-dir、browser、output-dir")
    if args.cold_runs < 1 or args.hot_samples < 1 or args.soak_seconds < 0:
        parser.error("冷热样本必须为正数，长时秒数不能为负")
    output = args.output_dir.resolve()
    if not output.is_relative_to(ROOT / "output" / "unified-prototype"):
        parser.error("产物必须写入output/unified-prototype下")
    if output.exists():
        parser.error("输出目录必须全新，避免覆盖历史证据")
    output.mkdir(parents=True)
    input_dir = args.input_dir.resolve()
    files, inventory = file_oracle(input_dir)
    result: dict[str, Any] = {
        "protocol": "unified-capacity-2",
        "command": sys.argv,
        "inventory": inventory,
        "environment": {
            "os": platform.platform(),
            "cpu": command(["sysctl", "-n", "machdep.cpu.brand_string"])
            if sys.platform == "darwin"
            else platform.processor(),
            "physicalMemoryBytes": psutil.virtual_memory().total,
            "logicalCpus": psutil.cpu_count(),
            "python": sys.version,
            "node": command(["node", "--version"]),
            "uv": command(["uv", "--version"]),
            "agentBrowser": command(["agent-browser", "--version"]),
            "browserExecutable": str(args.browser.resolve()),
            "headed": args.headed,
        },
        "inputs": [
            fingerprint(input_dir / n) for n in ("baseline.json", "current.json", "manifest.json")
        ],
        "sources": [
            fingerprint(p)
            for p in sorted(
                {
                    *(ROOT / "prototypes").rglob("*.py"),
                    *(ROOT / "prototypes").rglob("*.js"),
                    *(ROOT / "prototypes").rglob("*.css"),
                    *(ROOT / "prototypes").rglob("*.html"),
                    Path(__file__).resolve(),
                    ROOT / "scripts/prototype_checks/run_baseline.py",
                    ROOT / "scripts/prototype_checks/measure-init.js",
                }
            )
        ],
        "lock": fingerprint(ROOT / "uv.lock"),
        "gitHead": command(["git", "rev-parse", "HEAD"]),
        "runs": [],
        "limitations": [
            "Windows Chrome/Edge未测；macOS Edge未测，不能宣称兼容验收通过",
            "冷查询为独立profile内各任务首次测量，先前任务可能共享索引；OS磁盘缓存未控制",
            "计时不含agent-browser工具进程启动；包含DOM事件、Worker、DOM提交及后续两帧",
            "指标任务仅检查当前页数量和状态；完整业务预期未独立核对，不计作性能通过",
            "打包构建不含输入生成和完整L1/L2/L3；不能关闭完整报告生成门槛",
            "RSS共享页重计、枚举竞态和采样间隙峰值漏采",
            "agent-browser与Chrome DevTools的WebSocket通道偶发reset（判定见stage5-cdp-repro/verdict.md）："
            "命中签名的失败会话整体丢弃，关闭残留会话后以新profile重建同编号会话重跑；"
            "每会话最多重试3次，soak中断连重启完整soak不拼接两段；"
            "重试登记于channelRetries、被弃产物保留在discarded/，重试会话的计时、采样与P95语义与首次一致",
        ],
    }
    dump(output / "results.json", result)
    artifact = args.report.resolve() if args.report else output / "report/cmetrics-prototype.html"
    if not args.report:
        try:
            result["build"] = build(input_dir, artifact.parent)
        except Exception as exc:
            result["status"] = "build-failed"
            result["error"] = str(exc)
            dump(output / "results.json", result)
            raise
    result["artifact"] = fingerprint(artifact)
    result["sourcesAfterBuild"] = [fingerprint(Path(p["path"])) for p in result["sources"]]
    result["sourcesChangedDuringBuild"] = result["sources"] != result["sourcesAfterBuild"]
    result["reportProvenance"] = (
        "外部HTML：当前源码摘要仅记录测量环境，不能证明HTML来自当前源码"
        if args.report
        else "本次独立构建；若sourcesChangedDuringBuild为true，须在源码稳定后重建"
    )
    dump(output / "results.json", result)
    initial_failures = []
    if result["artifact"]["bytes"] > 200 * 1024**2:
        initial_failures.append(
            {
                "kind": "html-size",
                "observedBytes": result["artifact"]["bytes"],
                "limitBytes": 200 * 1024**2,
            }
        )
    if result.get("build", {}).get("wallSeconds", 0) > 600:
        initial_failures.append(
            {
                "kind": "packaging-time",
                "observedSeconds": result["build"]["wallSeconds"],
                "limitSeconds": 600,
            }
        )
    if (result.get("build", {}).get("memory", {}).get("peakRssBytes") or 0) > 8 * 1024**3:
        initial_failures.append(
            {
                "kind": "packaging-rss",
                "observedBytes": result["build"]["memory"]["peakRssBytes"],
                "limitBytes": 8 * 1024**3,
            }
        )
    if initial_failures or result["sourcesChangedDuringBuild"]:
        result["status"] = "threshold-failed" if initial_failures else "source-changed"
        result["thresholdFailures"] = initial_failures
        dump(output / "results.json", result)
        raise SystemExit(1)
    if args.browser_release_file:
        release = args.browser_release_file.resolve()
        result["status"] = "waiting-for-browser-release"
        result["browserReleaseFile"] = str(release)
        dump(output / "results.json", result)
        while not release.exists():
            print("构建完成，等待浏览器采样放行文件", flush=True)
            threading.Event().wait(10)
        result["browserReleasedAtUnix"] = time.time()
        result["status"] = "sampling"
        dump(output / "results.json", result)
    code = TASK_JS.replace(
        "CONFIG",
        json.dumps(
            {"files": files, "methodName": inventory["actual"]["baseline"]["sampleMethodName"]},
            ensure_ascii=False,
        ),
    )
    failed = False

    def run_session(index: int) -> dict[str, Any]:
        """跑完一个编号的冷会话；DevTools通道断开时整会话丢弃、新profile重建重跑。

        会话级重试：命中通道签名的失败尝试（含其已采样本）不并入统计，产物移入
        discarded/；soak中断连同样整会话重跑，即完整重启soak、不拼接两段。
        """
        attempt = 0
        while True:
            attempt += 1
            print(
                f"冷会话 {index + 1}/{args.cold_runs}"
                + (f"（通道重试 {attempt - 1}/{MAX_CHANNEL_RETRIES}）" if attempt > 1 else ""),
                flush=True,
            )
            browser = CapacityBrowser(
                output / f"cold-{index + 1:02}", args.browser.resolve(), headed=args.headed
            )
            run: dict[str, Any] = {"index": index + 1, "cold": [], "hot": [], "soak": []}
            if len(result["runs"]) > index:
                result["runs"][index] = run
            else:
                result["runs"].append(run)
            failure: BaseException | None = None
            try:
                run["browser"] = browser.start()
                run["startup"] = browser.open_report(artifact)
                ready_ms = run["startup"]["probe"]["readyPaintMs"]
                if ready_ms is None or ready_ms > 10000:
                    run["thresholdFailures"] = [
                        {"kind": "ready-time", "observedMs": ready_ms, "limitMs": 10000}
                    ]
                    raise RuntimeError("页面就绪超过10秒门槛")
                browser.sampler.phase = "cold-tasks"
                run["cold"].append(browser.evaluate(code))
                enforce_browser_limits(browser, run, "cold")
                dump(output / "results.json", result)
                if index == 0:
                    browser.sampler.phase = "hot-tasks"
                    for sample in range(args.hot_samples):
                        run["hot"].append(browser.evaluate(code))
                        enforce_browser_limits(browser, run, "hot")
                        dump(output / "results.json", result)
                        print(f"热样本 {sample + 1}/{args.hot_samples}", flush=True)
                    browser.sampler.phase = "soak"
                    start = time.perf_counter()
                    while time.perf_counter() - start < args.soak_seconds:
                        run["soak"].append(browser.evaluate(code))
                        run["soakElapsedSeconds"] = time.perf_counter() - start
                        enforce_browser_limits(browser, run, "soak")
                        dump(output / "results.json", result)
                        print(
                            f"长时 {run['soakElapsedSeconds']:.1f}/{args.soak_seconds:.1f}s",
                            flush=True,
                        )
                run["errors"] = browser.call("errors")
                run["network"] = browser.call("network", "requests")
                if run["errors"].get("errors") or any(
                    r.get("url", "").startswith(("http:", "https:"))
                    for r in run["network"].get("requests", [])
                ):
                    raise RuntimeError("页面异常或出现外连请求")
                run["status"] = "sampled"
            except Exception as exc:
                run["status"] = "failed"
                run["error"] = str(exc)
                failure = exc
            finally:
                try:
                    run["memory"] = browser.finish()
                except Exception as exc:
                    run["cleanupError"] = str(exc)
                    failure = failure or exc
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
    result["summaries"] = {
        mode: summaries(result["runs"], mode) for mode in ("cold", "hot", "soak")
    }
    cold_thresholds = [
        {"task": s["task"], "observedMs": s["p95Ms"], "limitMs": 1000}
        for s in result["summaries"]["cold"]
        if s["p95Ms"] is not None and s["p95Ms"] > 1000
    ]
    if cold_thresholds:
        failed = True
        result["coldThresholdFailures"] = cold_thresholds
    result["performanceGroups"] = {
        mode: {
            "independentlyCheckedFileTasks": [
                s for s in values if s["performanceGroup"] == "independently-checked-file-tasks"
            ],
            "metricsAwaitingIndependentFullSequence": [
                s
                for s in values
                if s["performanceGroup"] == "metrics-awaiting-independent-full-sequence"
            ],
        }
        for mode, values in result["summaries"].items()
    }
    result["sourcesAfterMeasurement"] = [fingerprint(Path(p["path"])) for p in result["sources"]]
    result["sourcesChangedDuringMeasurement"] = (
        result["sourcesAfterMeasurement"] != result["sourcesAfterBuild"]
    )
    result["requested"] = {
        "coldRuns": args.cold_runs,
        "hotSamples": args.hot_samples,
        "soakSeconds": args.soak_seconds,
    }
    result["soakDurationSufficient"] = result["runs"][0].get("soakElapsedSeconds", 0) >= 1800
    for run in result["runs"]:
        rss_path = output / f"cold-{run['index']:02}" / "rss-samples.json"
        if rss_path.exists():
            rss = json.loads(rss_path.read_text())
            soak = [s["rssBytes"] for s in rss if s["phase"] == "soak" and s["processes"]]
            run["soakMemory"] = {
                "samples": len(soak),
                "firstMedianBytes": statistics.median(soak[:50]) if soak else None,
                "lastMedianBytes": statistics.median(soak[-50:]) if soak else None,
                "limitation": "仅登记长时RSS趋势，不据此自动认定不存在泄漏",
            }
    result["sampleCountsSufficient"] = (
        len(result["runs"]) >= 20
        and all(len(r["cold"]) == 1 and r.get("status") == "sampled" for r in result["runs"])
        and len(result["runs"][0]["hot"]) >= 20
    )
    result["status"] = "failed" if failed else "measured-not-accepted"
    dump(output / "results.json", result)
    print(f"结果：{output / 'results.json'}", flush=True)
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
