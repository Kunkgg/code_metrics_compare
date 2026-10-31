/* 测量探针只由检查工具注入，不进入报告产物；不改写业务函数。 */
(() => {
  const sample = window.__prototypeMeasure = {shellReadyMs: null, readyPaintMs: null, errors: [], longTasks: []};
  window.addEventListener('error', event => sample.errors.push({message: event.message, source: event.filename}));
  window.addEventListener('unhandledrejection', event => sample.errors.push({message: String(event.reason)}));
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) sample.longTasks.push({startMs: entry.startTime, durationMs: entry.duration});
    }).observe({type: 'longtask', buffered: true});
  }
  const observer = new MutationObserver(() => {
    if (sample.shellReadyMs !== null || !document.documentElement?.classList.contains('interactive-ready')) return;
    sample.shellReadyMs = performance.now();
    observer.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => { sample.readyPaintMs = performance.now(); }));
  });
  observer.observe(document, {subtree: true, attributes: true, attributeFilter: ['class']});
})();
