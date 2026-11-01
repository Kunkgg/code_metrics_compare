"""统一原型小规模边界回放；构建独立产物并在断网 Chrome 执行。"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

from prototypes.ui.compact_report import build_compact_report
from prototypes.ui.prototype import load_metric_names
from scripts.prototype_checks.run_baseline import dump, fingerprint

ROOT = Path(__file__).resolve().parents[2]
CHECKS = ROOT / "scripts/prototype_checks"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=ROOT / "output/unified-prototype/next-boundaries"
    )
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    session = "boundaries-" + uuid.uuid4().hex[:10]
    calls: list[dict[str, Any]] = []
    results: dict[str, Any] = {}

    def browser(*params: str, source: str | None = None) -> Any:
        process = subprocess.run(
            ["agent-browser", "--session", session, "--json", *params],
            input=source,
            text=True,
            capture_output=True,
            timeout=60,
            check=False,
        )
        response = json.loads(process.stdout)
        calls.append({"args": params, "response": response})
        dump(output / "browser-commands.json", calls)
        if not response.get("success"):
            raise RuntimeError(response.get("error"))
        return response["data"]

    def evaluate(source: str) -> Any:
        return browser("eval", "--stdin", source=source)["result"]

    def ready() -> None:
        browser("wait", "--fn", "document.documentElement.dataset.queryState==='ready'")

    def run(name: str, report: Path, script: str) -> None:
        browser("open", report.as_uri())
        ready()
        results[name] = evaluate((CHECKS / script).read_text(encoding="utf-8"))
        if results[name].get("result") != "passed":
            raise RuntimeError(f"检查失败：{name}")
        dump(output / "results.json", results)

    try:
        browser("open", "about:blank")
        browser("set", "offline", "on")
        results["environment"] = evaluate(
            "({userAgent:navigator.userAgent,offline:!navigator.onLine})"
        )
        # 复制批准输入，仅添加构建所需 manifest，不改变 Golden 文件。
        for fixture in ("empty", "threshold-change", "method-lines"):
            destination = output / fixture
            destination.mkdir(exist_ok=True)
            for side in ("baseline", "current"):
                shutil.copyfile(
                    ROOT / f"tests/fixtures/golden/{fixture}/{side}.json",
                    destination / f"{side}.json",
                )
            reports = [
                json.loads((destination / f"{side}.json").read_text())
                for side in ("baseline", "current")
            ]
            paths = set().union(*(r["detail_metrics"]["file_sizes"] for r in reports))
            dump(
                destination / "manifest.json",
                {"root": "/golden/project", "config": {"seed": 1}, "unionFiles": len(paths)},
            )
            build_compact_report(destination, destination)
        threshold = output / "threshold-change/cmetrics-prototype.html"
        browser("open", threshold.as_uri())
        ready()
        expected = json.loads(
            (ROOT / "tests/fixtures/golden/threshold-change/expected.json").read_text()
        )
        evaluate("window.__thresholdExpected=" + json.dumps(expected, ensure_ascii=False))
        results["threshold"] = evaluate((CHECKS / "check-unified-threshold-browser.js").read_text())
        run(
            "unchanged",
            output / "method-lines/cmetrics-prototype.html",
            "check-unified-unchanged.js",
        )
        run("zero", output / "empty/cmetrics-prototype.html", "check-unified-zero.js")
        story = output / "story-input"
        generated = subprocess.run(
            [
                sys.executable,
                "-m",
                "prototypes.ui.prototype",
                "--compact",
                "--output-dir",
                str(story),
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=True,
        )
        (output / "story-generation.txt").write_text(generated.stdout + generated.stderr)
        story_html = (story / "cmetrics-prototype.html").read_text()
        story_match = re.search(
            r'<script type="application/json" id="report-data">(.*?)</script>', story_html, re.S
        )
        assert story_match is not None
        story_meta = json.loads(story_match[1])["meta"]
        story_meta.pop("integrity", None)
        report = build_compact_report(story, output / "story", ui_meta=story_meta)
        run("overview", report, "check-unified-overview.js")
        run("resilience", report, "check-unified-resilience.js")
        # 在实际 reader 启动前注入 Worker 构造失败，验证初始化失败和重试。
        original = report.read_text(encoding="utf-8")
        failed = output / "worker-init-failure.html"
        failed.write_text(
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
        browser("open", failed.as_uri())
        browser("wait", "--fn", "document.documentElement.dataset.queryState==='error'")
        results["workerInitFailure"] = evaluate(
            "({staticRows:document.querySelectorAll('#fallback tbody tr:has(td)').length,interactive:document.documentElement.classList.contains('interactive-ready'),retry:!!document.querySelector('[data-action=retry]')})"
        )
        assert results["workerInitFailure"] == {
            "staticRows": 20,
            "interactive": False,
            "retry": True,
        }
        evaluate("document.querySelector('[data-action=retry]').click()")
        ready()
        results["workerInitRetry"] = True
        crashed = output / "worker-crash.html"
        crashed.write_text(
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
        browser("open", crashed.as_uri())
        ready()
        evaluate(
            "window.__crashNext=true;document.querySelector('[data-action=view][data-value=workspace]').click()"
        )
        browser("wait", "--fn", "document.documentElement.dataset.queryState==='error'")
        results["workerCrash"] = evaluate(
            "({notice:document.querySelector('#query-notice').textContent,previousVisible:document.documentElement.classList.contains('interactive-ready')})"
        )
        assert (
            results["workerCrash"]["previousVisible"]
            and "上次成功结果" in results["workerCrash"]["notice"]
        )
        evaluate("document.querySelector('[data-action=retry]').click()")
        ready()
        results["workerCrashRetry"] = True
        # 同时检查不可信数据的 script 闭合串和模板标记，原值必须可阅读。
        marker = '@@DATA@@</script><svg onload="window.__dataInjected=1">&'
        injected = build_compact_report(
            story,
            output / "injection",
            ui_meta={"metricNames": {**load_metric_names(), "code_size": marker}},
        )
        assert "<td>@@DATA@@&lt;/script&gt;" in injected.read_text()
        browser("open", injected.as_uri())
        ready()
        results["dataInjection"] = evaluate(
            "({executed:!!window.__dataInjected,maliciousNodes:document.querySelectorAll('svg[onload]').length,name:document.querySelector('[data-overview-metric=code_size] .metric-name').textContent,staticName:document.querySelector('[data-static-metric=code_size] td').textContent})"
        )
        assert (
            not results["dataInjection"]["executed"]
            and not results["dataInjection"]["maliciousNodes"]
        )
        assert results["dataInjection"]["staticName"] == marker and results["dataInjection"][
            "name"
        ].startswith(marker)
        # 路径、函数名称、组号走真实二进制打包及 DOM 查询链路。
        record_input = output / "record-injection"
        record_input.mkdir(exist_ok=True)
        reports = {
            side: json.loads((story / f"{side}.json").read_text())
            for side in ("baseline", "current")
        }
        first_method = reports["baseline"]["detail_metrics"]["method_metrics"][0]
        original_path, original_name = first_method["file_name"], first_method["method_name"]
        injected_path = (
            original_path.rsplit("/", 1)[0] + "/<img src=x onerror=window.__recordInjected=1>.c"
        )
        injected_name = "@@DATA@@</script><svg onload=window.__recordInjected=1>"
        replacements = {original_path: injected_path, original_name: injected_name}

        def mutate(value: Any) -> Any:
            if isinstance(value, str):
                return replacements.get(value, value)
            if isinstance(value, list):
                return [mutate(item) for item in value]
            if isinstance(value, dict):
                return {replacements.get(key, key): mutate(item) for key, item in value.items()}
            return value

        for side, raw in reports.items():
            dump(record_input / f"{side}.json", mutate(raw))
        shutil.copyfile(story / "manifest.json", record_input / "manifest.json")
        record_report = build_compact_report(record_input, record_input)
        browser("open", record_report.as_uri() + "?view=workspace")
        ready()
        record_script = """(async()=>{
          const wait=async()=>{while(document.documentElement.dataset.queryState==='loading')await new Promise(requestAnimationFrame);if(document.documentElement.dataset.queryState!=='ready')throw Error('查询失败');};
          const click=async s=>{document.querySelector(s).click();await wait();};
          await click('[data-action="analysis-type"][data-value="lines_per_method"]');
          await click('[data-action="status"][data-value="all"]');
          const input=document.querySelector('#query-form [name="query"]');input.value=PATH;input.dispatchEvent(new Event('input',{bubbles:true}));await wait();
          return {executed:!!window.__recordInjected,nodes:document.querySelectorAll('img[onerror],svg[onload]').length,found:document.querySelector('.data-table').textContent.includes(NAME),path:document.querySelector('.evidence-panel').textContent.includes(PATH),copy:document.querySelector('#location-text')?.value};
        })()""".replace("NAME", json.dumps(injected_name)).replace(
            "PATH",
            json.dumps(
                injected_path.split(
                    json.loads((story / "manifest.json").read_text())["root"].rstrip("/") + "/", 1
                )[-1]
            ),
        )
        results["recordInjection"] = evaluate(record_script)
        assert (
            not results["recordInjection"]["executed"] and results["recordInjection"]["nodes"] == 0
        )
        assert results["recordInjection"]["found"] and results["recordInjection"]["path"]
        browser("open", report.as_uri() + "?failInit=1")
        results["failInit"] = evaluate(
            "({rows:document.querySelectorAll('#fallback tbody tr:has(td)').length,interactive:document.documentElement.classList.contains('interactive-ready'),status:document.querySelector('#init-status').textContent})"
        )
        assert results["failInit"]["rows"] == 20 and not results["failInit"]["interactive"]
        # 删除执行脚本保留数据与 Worker 文本，独立检查没有 JS 执行的静态页面。
        static = output / "scripts-disabled.html"
        static.write_text(
            re.sub(r"<script>.*?</script>", "", original, flags=re.S), encoding="utf-8"
        )
        browser("open", static.as_uri())
        results["scriptsDisabled"] = evaluate(
            "({rows:document.querySelectorAll('#fallback tbody tr:has(td)').length,visible:document.querySelector('#fallback').getBoundingClientRect().height>0,app:document.querySelector('#app').textContent})"
        )
        assert results["scriptsDisabled"] == {"rows": 20, "visible": True, "app": ""}
        results["network"] = browser("network", "requests")
        assert not any(
            r.get("url", "").startswith(("http:", "https:"))
            for r in results["network"].get("requests", [])
        )
        results["fingerprints"] = [
            fingerprint(p) for p in sorted((ROOT / "prototypes/ui").glob("*")) if p.is_file()
        ]
        results["result"] = "passed"
    finally:
        dump(output / "results.json", results)
        browser("close")
    print(
        json.dumps(
            {"result": results.get("result", "failed"), "output": str(output)}, ensure_ascii=False
        )
    )


if __name__ == "__main__":
    main()
