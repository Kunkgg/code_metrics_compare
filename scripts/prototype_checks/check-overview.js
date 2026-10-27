(() => {
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  const state = () => JSON.parse(document.querySelector('.state-inspector pre').textContent);
  const click = selector => { const button = document.querySelector(selector); if (!button) throw new Error(`找不到 ${selector}`); button.click(); };
  const setDirections = selected => {
    for (const direction of ['growth', 'decrease', 'unchanged']) {
      if (state().overviewChanges.includes(direction) !== selected.includes(direction)) click(`[data-action="overview-toggle"][data-value="${direction}"]`);
    }
  };
  const goOverview = () => click('[data-action="view"][data-value="overview"]');
  const metricKeys = ['code_size','lines_per_file','lines_per_method','cyclomatic_complexity_per_method','code_duplication_ratio','file_duplication_ratio','unsafe_functions_total','redundant_code_total','non_hfile_code_duplication_ratio','non_hfile_duplication_ratio','huge_headerfile_total','huge_headerfile_ratio','huge_non_headerfile_total','huge_non_headerfile_ratio','huge_method_total','huge_method_ratio','huge_cyclomatic_complexity_total','huge_cyclomatic_complexity_ratio','huge_folder_total','huge_folder_ratio'];
  assert(state().overviewChanges.join() === 'growth,decrease', '默认选择增长与减少');
  for (const [directions, count] of [[[],0],[['growth'],18],[['decrease'],10],[['unchanged'],2],[['growth','decrease'],18],[['growth','unchanged'],20],[['decrease','unchanged'],12],[['growth','decrease','unchanged'],20]]) {
    setDirections(directions);
    assert(document.querySelectorAll('[data-overview-metric]').length === count, `多选 ${directions.join() || '空'}：${count} 张卡片`);
    assert(document.querySelectorAll('.overview-files').length === directions.length, `文件列表同步 ${directions.join() || '空'}`);
    assert(document.querySelectorAll('.overview-switches [aria-pressed="true"]').length === directions.length, '按钮选中状态正确');
    assert(document.documentElement.scrollWidth <= innerWidth, '概览无水平溢出');
    if (!directions.length) assert(document.querySelector('[data-action="overview-reset"]') !== null, '空选提供恢复默认');
    if (directions.join() === 'unchanged') assert(!document.querySelector('[data-overview-metric^="huge_"]'), '超限进出抵消不归为无变化');
    if (directions.join() === 'decrease') assert(!document.querySelector('.metric-card.has-growth'), '只选减少时卡片颜色对应退出');
  }
  assert([...document.querySelectorAll('[data-overview-metric]')].map(e => e.dataset.overviewMetric).join() === metricKeys.join(), '全部 20 项名称对应的身份和顺序一致');
  for (const key of metricKeys) {
    click(`[data-overview-metric="${key}"] .metric-summary`);
    assert(state().view === 'workspace' && state().metric === key, `卡片保留指标 ${key}`);
    assert(document.querySelector('.analysis-metrics [aria-pressed="true"]').dataset.value === key, '分析选中项正确');
    assert(state().status === (['unsafe_functions_total','redundant_code_total'].includes(key) ? 'all' : 'changes'), '汇总方向未混作明细方向');
    assert(document.documentElement.scrollWidth <= innerWidth, '分析下钻无水平溢出');
    goOverview();
    assert(state().overviewChanges.length === 3, '返回概览保留多选');
  }
  for (const key of metricKeys.filter(key => key.startsWith('huge_'))) {
    for (const status of ['entered','exited']) {
      click(`[data-overview-metric="${key}"] [data-status="${status}"]`);
      const current = state();
      assert(current.metric === key && current.status === status && current.result === 1, `${key} ${status} 精确进入 1 项`);
      assert(current.sort === (status === 'exited' ? 'delta:asc' : 'delta:desc'), '进出按对应方向排序');
      goOverview();
    }
  }
  const raw = JSON.parse(document.querySelector('#report-data').textContent);
  const files = [...new Set([...Object.keys(raw.baseline.detail_metrics.file_sizes), ...Object.keys(raw.current.detail_metrics.file_sizes)])];
  const counts = {growth:0,decrease:0,unchanged:0};
  for (const path of files) {
    const delta = (raw.current.detail_metrics.file_sizes[path]?.[0] || 0) - (raw.baseline.detail_metrics.file_sizes[path]?.[0] || 0);
    counts[delta > 0 ? 'growth' : delta < 0 ? 'decrease' : 'unchanged']++;
  }
  for (const direction of Object.keys(counts)) {
    click(`.overview-files[data-direction="${direction}"] [data-action="metric"]`);
    assert(state().status === direction && state().result === counts[direction], `文件 ${direction} 全量 ${counts[direction]} 项正确`);
    assert(document.querySelector('.query-tabs [aria-pressed="true"]').dataset.value === direction, '分析变化筛选选中正确');
    if (direction === 'unchanged') assert([...document.querySelectorAll('.data-table .badge')].every(e => e.textContent === '无变化'), '无变化列表只含相同度量');
    goOverview();
  }
  setDirections([]);
  click('[data-action="overview-reset"]');
  assert(state().overviewChanges.join() === 'growth,decrease', '恢复默认成功');
  return {checks:results.length, viewport:innerWidth, fileCounts:counts, result:'passed'};
})();
