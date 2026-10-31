/* 大数据容量验证原型主线程：顺序加载分块、三栏工作区、稳定搜索框与可复现测量接口。
 * 一次性原型：只验证容量与导航方式，不宣称替代完整业务原型。 */
'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtInt = value => value == null ? '—' : Number(value).toLocaleString('zh-CN');
  const decimalMetric = key => /(_ratio|_kloc|_per_file|_per_method)$/.test(key);
  const fmt = (value, decimal) => {
    if (value == null) return '—';
    const n = Number(value);
    const digits = decimal || !Number.isInteger(n) ? 2 : 0;
    return n.toLocaleString('zh-CN', {minimumFractionDigits: digits, maximumFractionDigits: digits});
  };
  const deltaText = (value, decimal) => value == null ? '—' : `${value >= 0.005 ? '+' : ''}${fmt(value, decimal)}`;
  const cls = value => value > 0 ? 'up' : value < 0 ? 'down' : 'muted';
  const badge = (text, style) => `<span class="badge ${style || ''}">${esc(text)}</span>`;
  const TYPE_TABS = [
    ['files', '文件'], ['duplication', '重复行'], ['methods', '函数'], ['dupfiles', '重复文件'],
    ['unsafe', '危险调用'], ['redundant', '冗余块'], ['folders', '超大目录'],
  ];
  const STATUS_TABS = {
    numeric: [['changes','全部变化'],['growth','增长'],['decrease','减少'],['unchanged','无变化'],['all','全部对象']],
    existence: [['changes','全部变化'],['entered','新增'],['exited','移出'],['unchanged','无变化'],['all','全部记录']],
    methods: [['changes','全部变化'],['growth','增长'],['decrease','减少'],['ambiguous','同名歧义'],['unchanged','无变化'],['all','全部对象']],
    folders: [['changes','全部变化'],['entered','新增超限'],['exited','退出超限'],['unchanged','无变化'],['all','全部目录']],
  };
  const statusTabsFor = type => type === 'methods' ? STATUS_TABS.methods
    : type === 'folders' ? STATUS_TABS.folders
    : ['dupfiles', 'unsafe', 'redundant'].includes(type) ? STATUS_TABS.existence : STATUS_TABS.numeric;
  // 概览卡片到查询的映射；未列出的指标在本轮容量原型中不接线。
  const METRIC_LINK = {
    code_size: {type: 'files'}, lines_per_file: {type: 'files'},
    lines_per_method: {type: 'methods'}, cyclomatic_complexity_per_method: {type: 'methods', metric: 'cc'},
    code_duplication_ratio: {type: 'duplication'}, non_hfile_code_duplication_ratio: {type: 'duplication'},
    file_duplication_ratio: {type: 'dupfiles'}, non_hfile_duplication_ratio: {type: 'dupfiles'},
    unsafe_functions_total: {type: 'unsafe'}, redundant_code_total: {type: 'redundant'},
    huge_folder_total: {type: 'folders'}, huge_folder_ratio: {type: 'folders'},
  };

  let META = null, worker = null;
  const state = {
    view: 'overview', type: 'files', metric: 'lines', directory: '', dirSearch: '', dirPage: 1,
    search: '', status: 'changes', sort: 'delta-desc', page: 1, pageSize: 50,
    selected: null, fragPages: {}, memberPage: 1, memberQuery: '', memberStatus: 'changes',
  };
  let version = 0;
  const pending = new Map();
  const generations = {query: 0, directories: 0, evidence: 0};
  const activeRequests = new Set();
  function beginRequest(channel) {
    const generation = ++generations[channel];
    activeRequests.add(`${channel}:${generation}`);
    scale.busy = true;
    return generation;
  }
  function finishRequest(channel, generation) {
    activeRequests.delete(`${channel}:${generation}`);
    scale.busy = activeRequests.size > 0;
  }
  function currentRequest(channel, generation) {
    return generation === generations[channel] && state.view === 'workspace';
  }
  const metrics = {init: {}, entries: []};
  const scale = {
    ready: false, busy: false, state, metrics,
    run: null, bench: null,
  };
  window.scalePrototype = scale;

  function send(op, extra) {
    const id = ++version;
    return new Promise((resolve, reject) => {
      pending.set(id, {resolve, reject, op});
      worker.postMessage({op, id, ...extra});
    });
  }

  function toast(text) {
    $('#toast').textContent = text;
    $('#toast').classList.add('visible');
    setTimeout(() => $('#toast').classList.remove('visible'), 2200);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('已复制'); }
    catch { toast('请手动复制：' + text.slice(0, 80)); }
  }

  function twoRaf() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function log(entry) {
    metrics.entries.push({t: Date.now(), ...entry});
    if (metrics.entries.length > 500) metrics.entries.shift();
  }

  async function loadBlocks() {
    const status = $('#init-status');
    const nodes = [...document.querySelectorAll('script[data-block-kind]')];
    const total = nodes.length;
    const t0 = performance.now();
    const perKind = {};
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const kind = node.dataset.blockKind;
      const reply = await send('load', {kind, b64: node.textContent});
      perKind[kind] = reply.ms;
      node.remove();
      const percent = Math.round(((i + 1) / total) * 90);
      const bar = $('#load-progress');
      if (bar) bar.value = percent;
      status.textContent = `正在解压与加载 ${i + 1}/${total}：${kind}（${reply.ms} ms）`;
    }
    const ready = await new Promise((resolve, reject) => {
      const id = ++version;
      pending.set(id, {resolve, reject, op: 'finish'});
      worker.postMessage({op: 'finish', id});
    });
    metrics.init = {loadMs: Math.round(performance.now() - t0), perKind, ready};
    return ready;
  }

  function headerHtml() {
    const s = META.scale || {};
    const numFiles = s.num_files ?? s.numFiles ?? 0;
    const changeRate = s.change_rate ?? s.changeRate;
    const info = `${fmtInt(numFiles)} 文件／侧 · ${fmtInt(numFiles * 10)} 函数／侧 · 变化率 ${changeRate ?? '—'} · ${esc(s.shape || '')}`;
    return `<header class="app-header capacity-head"><div class="brand"><span class="brand-mark"><i></i><i></i><i></i></span>Cmetrics</div>
      <nav>${[['overview','概览'],['workspace','分析']].map(([v, l]) => `<button data-action="view" data-value="${v}" class="${state.view === v ? 'active' : ''}">${l}</button>`).join('')}</nav>
      <button class="text" data-action="verify">运行自校验</button>
      <span class="spacer"></span><span class="scale-info">${info} · 模拟数据 / 容量验证原型</span></header>
      <div id="verify-region"></div>`;
  }

  function metricCard(entry) {
    const [key, unit, group] = entry;
    const name = META.metricNames[key] || key;
    const b = META.summaries.baseline[key], c = META.summaries.current[key];
    const delta = c - b;
    const decimal = decimalMetric(key);
    const link = METRIC_LINK[key];
    const chip = delta > 0 ? badge('增长', 'growth') : delta < 0 ? badge('减少', 'decrease') : badge('无变化');
    const clickable = link ? `data-action="metric-card" data-value="${key}"` : 'disabled title="本轮容量原型未接线"';
    return `<button class="metric-card" ${clickable}><span class="metric-name">${esc(name)}</span>
      <span class="metric-values"><b>${fmt(b, decimal)}</b> → <b>${fmt(c, decimal)}</b></span>
      <span class="metric-delta ${cls(delta)}">${deltaText(delta, decimal)} ${esc(unit)} ${chip}</span></button>`;
  }

  function overviewHtml() {
    const groups = {};
    for (const entry of META.mainMetrics) {
      (groups[entry[2]] = groups[entry[2]] || []).push(entry);
    }
    return Object.entries(groups).map(([label, entries]) => `<section class="overview-category"><div class="section-head"><h2>${esc(label)}</h2><span class="muted small">${entries.length} 项</span></div>
      <div class="metrics-grid">${entries.map(metricCard).join('')}</div></section>`).join('') +
      `<p class="muted small">容量验证原型：点击已接线指标进入对应明细；超大文件／函数类指标本轮未接线。数据规模与生成配置见页面底部。</p>
      <details class="data-notes"><summary>数据与验证说明</summary><div class="panel"><p>生成配置：${esc(JSON.stringify(META.scale))}</p><p>生成耗时 ${META.manifest?.measurement?.generationSeconds ?? '—'} s，峰值 RSS ${META.manifest?.measurement?.peakRssMiB ?? '—'} MiB（生成端）。</p><p>紧凑规则合成数据，未执行逐有效行 L3 校验；小规模同路径数据已通过 L1/L2。</p></div></details>`;
  }

  function buildWorkspace() {
    if ($('#workspace-root')) return;
    $('#view').innerHTML = `<div id="workspace-root" class="workspace-3col">
      <section class="panel dir-panel"><div class="panel-head"><h3>目录</h3><span id="dir-total" class="small muted"></span></div>
        <div id="dir-crumbs" class="crumbs"></div>
        <input id="dir-search" class="search" placeholder="搜索目录路径，即时查找" aria-label="搜索目录路径">
        <div id="dir-scope" class="scope-line"></div><div id="dir-list" class="dir-list"></div><div id="dir-pager" class="mini-pagination"></div></section>
      <section class="panel query-panel"><div class="panel-head"><h3>明细</h3><span id="q-count" class="small muted"></span></div>
        <div id="type-tabs" class="type-tabs"></div>
        <div class="query-toolbar"><select id="metric-select" aria-label="度量"><option value="lines">代码行</option><option value="cc">圈复杂度</option></select>
          <select id="sort-select" aria-label="排序"><option value="delta-desc">变化幅度从大到小</option><option value="delta-asc">变化幅度从小到大</option><option value="current-desc">当前值从大到小</option><option value="current-asc">当前值从小到大</option><option value="path-asc">路径 A→Z</option></select>
          <button class="text" data-action="reset">恢复默认</button></div>
        <input id="q-search" class="search" placeholder="输入路径或名称，即时查找" aria-label="搜索路径或名称">
        <div id="status-tabs" class="status-tabs"></div><div id="q-scope" class="scope-line"></div>
        <div id="table-region" class="table-wrap"></div><div id="q-pager" class="mini-pagination"></div></section>
      <section class="panel evidence-panel"><div class="panel-head"><h3>证据</h3><span id="ev-title" class="small muted"></span></div><div id="evidence-region"><p class="muted">选择左侧对象查看证据。</p></div></section>
    </div>`;
    $('#metric-select').value = state.metric;
    $('#sort-select').value = state.sort;
    $('#dir-search').addEventListener('input', debounceComposition(e => {
      state.dirSearch = e.target.value; state.dirPage = 1; refreshDirectories();
    }));
    $('#q-search').addEventListener('input', debounceComposition(e => {
      state.search = e.target.value; state.page = 1; refreshTable();
    }));
    $('#metric-select').addEventListener('change', e => { state.metric = e.target.value; state.page = 1; refreshTable(); });
    $('#sort-select').addEventListener('change', e => { state.sort = e.target.value; state.page = 1; refreshTable(); });
  }

  function debounceComposition(handler) {
    let timer = null;
    return event => {
      if (event.isComposing) return;
      clearTimeout(timer);
      const target = event.target;
      timer = setTimeout(() => handler({target}), 150);
    };
  }

  function renderTypeTabs() {
    $('#type-tabs').innerHTML = TYPE_TABS.map(([value, label]) => `<button data-action="type" data-value="${value}" class="${state.type === value ? 'active' : ''}">${label}</button>`).join('');
    $('#metric-select').style.display = state.type === 'methods' ? '' : 'none';
  }

  function renderStatusTabs(counts) {
    $('#status-tabs').innerHTML = statusTabsFor(state.type).map(([value, label]) => {
      const count = counts ? (value === 'changes' ? counts.changes : counts[value] ?? 0) : '';
      return `<button data-action="status" data-value="${value}" class="${state.status === value ? 'active' : ''}">${label}<span>${count}</span></button>`;
    }).join('');
  }

  function rowStatus(row) {
    if (row.flags.includes('ambiguous')) return badge('同名歧义', 'warning');
    const parts = [];
    if (row.flags.includes('entered')) parts.push(badge(row.kind === 'position' ? '记录新增' : row.kind === 'folder' ? '新增超限' : '新增', 'growth'));
    if (row.flags.includes('exited')) parts.push(badge(row.kind === 'position' ? '记录消失' : row.kind === 'folder' ? '退出超限' : '移出', 'decrease'));
    if (row.flags.includes('growth')) parts.push(badge('增长', 'growth'));
    if (row.flags.includes('decrease')) parts.push(badge('减少', 'decrease'));
    if (!parts.length && row.flags.includes('unchanged')) parts.push(badge('无变化'));
    return parts.join(' ');
  }

  function renderTable(payload) {
    const decimal = false;
    const rows = payload.rows.map(row => `<tr data-action="select" data-value="${esc(row.id)}" class="${state.selected === row.id ? 'selected' : ''}">
      <td class="path-cell mono">${esc(row.path)}${row.kind === 'method' ? ` <span class="muted">· ${esc(row.name)}</span>` : ''}</td>
      <td class="num">${row.b == null ? '—' : fmt(row.b, decimal)}</td>
      <td class="num">${row.c == null ? '—' : fmt(row.c, decimal)}</td>
      <td class="num ${cls(row.delta)}">${row.delta == null ? '—' : deltaText(row.delta, decimal)}</td>
      <td>${rowStatus(row)}</td></tr>`).join('');
    $('#table-region').innerHTML = `<table class="rows-table"><thead><tr><th>路径</th><th class="num">基线</th><th class="num">当前</th><th class="num">变化</th><th>状态</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="empty">无匹配结果</td></tr>`}</tbody></table>`;
    $('#q-count').textContent = `找到 ${fmtInt(payload.total)} 项 · 第 ${payload.page}/${payload.pages} 页`;
    const sc = payload.scope;
    $('#q-scope').textContent = `范围 ${state.directory || '全部'}：基线 ${fmtInt(sc.filesB)} 文件／${fmtInt(sc.codeB)} 行，当前 ${fmtInt(sc.filesC)} 文件／${fmtInt(sc.codeC)} 行`;
    $('#q-pager').innerHTML = `<span>${fmtInt(payload.total)} 项</span>
      <div class="row"><button data-action="page" data-value="-1" ${payload.page <= 1 ? 'disabled' : ''}>←</button><span>${payload.page} / ${payload.pages}</span><button data-action="page" data-value="1" ${payload.page >= payload.pages ? 'disabled' : ''}>→</button></div>`;
  }

  function renderDirectories(payload) {
    const crumbs = payload.crumbs.map((c, i) => i === payload.crumbs.length - 1 ? `<span class="current">${esc(c.name || '全部')}</span>` : `<button data-action="dir-crumb" data-value="${esc(c.path)}">${esc(c.name || '全部')}</button>`).join(' / ');
    $('#dir-crumbs').innerHTML = crumbs;
    $('#dir-list').innerHTML = payload.rows.map(d => {
      const huge = (d.kB != null || d.kC != null || d.measuredC > (META.summaries.current.huge_threshold?.huge_folder ?? Infinity)) ? '<span class="huge-mark" title="超大目录">超</span>' : '';
      return `<button class="dir-row ${state.directory === d.path ? 'active' : ''}" data-action="dir-open" data-value="${esc(d.path)}" title="${esc(d.path)}">
        <span class="dir-name">${esc(d.name)}</span>${huge}<span class="dir-count">${fmtInt(d.cFiles)} 文件</span></button>`;
    }).join('') || '<p class="muted small">无匹配目录</p>';
    $('#dir-total').textContent = state.dirSearch ? `匹配 ${fmtInt(payload.total)} 个目录` : `${fmtInt(payload.total)} 个子目录`;
    const sc = payload.scope;
    $('#dir-scope').textContent = `${state.directory || '全部'}：基线 ${fmtInt(sc.filesB)}／当前 ${fmtInt(sc.filesC)} 文件，代码 ${fmtInt(sc.codeB)} → ${fmtInt(sc.codeC)} 行`;
    $('#dir-pager').innerHTML = payload.pages > 1 ? `<span>${fmtInt(payload.total)} 目录</span><div class="row"><button data-action="dir-page" data-value="-1" ${payload.page === 1 ? 'disabled' : ''}>←</button><span>${payload.page} / ${payload.pages}</span><button data-action="dir-page" data-value="1" ${payload.page === payload.pages ? 'disabled' : ''}>→</button></div>` : '';
  }

  function fragPagination(key, group) {
    return `<div class="mini-pagination"><span>${fmtInt(group.total)} 成员</span><div class="row">
      <button data-action="ev-frag" data-key="${esc(key)}" data-value="-1" ${group.page === 1 ? 'disabled' : ''}>←</button><span>${group.page} / ${group.pages}</span>
      <button data-action="ev-frag" data-key="${esc(key)}" data-value="1" ${group.page === group.pages ? 'disabled' : ''}>→</button></div></div>`;
  }

  function renderEvidence(payload) {
    const region = $('#evidence-region');
    if (!payload) { region.innerHTML = '<p class="muted">选择左侧对象查看证据。</p>'; $('#ev-title').textContent = ''; return; }
    $('#ev-title').textContent = payload.path || '';
    if (payload.kind === 'file') {
      const f = payload.file;
      const triple = [['非空非注释代码行', f.bN, f.cN], ['物理行', f.bR, f.cR], ['重复行', f.bD, f.cD]].map(([l, b, c]) => `<tr><td>${l}</td><td class="num">${fmtInt(b)}</td><td class="num">${fmtInt(c)}</td></tr>`).join('');
      const methodRows = (label, records) => `<div class="evidence-section"><h3>${label}函数 ${records.length}</h3><div class="evidence-records">${records.map(m => `<div class="raw-row"><strong class="mono">${esc(m.name)}</strong> <span class="muted">L${m.start}–${m.end}</span> <span>行 <b>${fmtInt(m.lines)}</b> · CC <b>${fmtInt(m.cc)}</b></span></div>`).join('') || '<p class="muted">无记录</p>'}</div></div>`;
      const fragBlocks = payload.fragGroups.map(g => {
        const key = `${g.side}:${g.groupId}`;
        return `<div class="group-block"><div class="group-head"><strong>${g.label} · 组 ${esc(g.groupId)}</strong><span class="muted">${g.total} 片段</span></div>
          <ul class="member-list">${g.members.map(m => `<li class="mono">${esc(m.path)}:${m.start}（${m.len} 行）${m.self ? badge('本文件', 'teal') : ''}</li>`).join('')}</ul>${fragPagination(key, g)}</div>`;
      }).join('');
      const dupBlocks = payload.dupGroups.map(g => {
        const key = `dup:${g.side}:${g.groupId}`;
        return `<div class="group-block"><div class="group-head"><strong>${g.label} · 整文件重复组 ${esc(g.groupId)}</strong><span class="muted">${g.total} 文件</span></div>
          <ul class="member-list">${g.members.map(m => `<li class="mono">${esc(m.path)}${m.self ? badge('本文件', 'teal') : ''}</li>`).join('')}</ul>${fragPagination(key, g)}</div>`;
      }).join('');
      const unsafeBlock = payload.unsafeRows.length ? `<div class="evidence-section"><h3>危险调用 ${payload.unsafeRows.length}</h3>${payload.unsafeRows.map(r => `<div class="raw-row">${esc(r.name)} L${r.line} ${r.b && r.c ? badge('两侧') : r.c ? badge('仅当前', 'growth') : badge('仅基线', 'decrease')}</div>`).join('')}</div>` : '';
      const redundantBlock = payload.redundantRows.length ? `<div class="evidence-section"><h3>冗余块 ${payload.redundantRows.length}</h3>${payload.redundantRows.map(r => `<div class="raw-row">L${r.line} ${r.b && r.c ? badge('两侧') : r.c ? badge('仅当前', 'growth') : badge('仅基线', 'decrease')}</div>`).join('')}</div>` : '';
      region.innerHTML = `<div class="pair-values"><div><small>基线</small><strong>${payload.existsB ? '存在' : '—'}</strong></div><span class="pair-arrow">→</span><div><small>当前</small><strong>${payload.existsC ? '存在' : '—'}</strong></div></div>
        <table><thead><tr><th>指标</th><th class="num">基线</th><th class="num">当前</th></tr></thead><tbody>${triple}</tbody></table>
        ${methodRows('基线', payload.methodsB)}${methodRows('当前', payload.methodsC)}
        ${fragBlocks ? `<div class="evidence-section"><h3>重复片段组</h3>${fragBlocks}</div>` : ''}
        ${dupBlocks ? `<div class="evidence-section"><h3>整文件重复</h3>${dupBlocks}</div>` : ''}
        ${unsafeBlock}${redundantBlock}`;
      return;
    }
    if (payload.kind === 'method') {
      const records = (label, list) => list.map(r => `<div class="raw-row"><span class="muted">${label}</span> L${r.start}–${r.end} · 行 <b>${fmtInt(r.lines)}</b> · CC <b>${fmtInt(r.cc)}</b></div>`).join('') || '<p class="muted">无记录</p>';
      region.innerHTML = `<h3 class="mono">${esc(payload.name)}</h3><p class="mono muted small">${esc(payload.path)}</p>
        ${payload.ambiguous ? '<div class="notice">同文件同名，无法确定配对；两侧记录全部保留。</div>' : ''}
        <div class="evidence-records">${records('基线', payload.recordsB)}${records('当前', payload.recordsC)}</div>
        <div class="copy-block"><button class="text" data-action="copy" data-value="${esc(payload.path)}">复制文件路径</button></div>`;
      return;
    }
    if (payload.kind === 'folder') {
      const m = payload.members;
      const mismatch = [];
      if (payload.declaredB != null && payload.declaredB !== payload.measuredB) mismatch.push(`基线计数 ${payload.declaredB}，可见成员 ${payload.measuredB}`);
      if (payload.declaredC != null && payload.declaredC !== payload.measuredC) mismatch.push(`当前计数 ${payload.declaredC}，可见成员 ${payload.measuredC}`);
      region.innerHTML = `<div class="member-summary"><span class="up"><strong>+${payload.counts.entered}</strong> 新增</span><span class="down"><strong>−${payload.counts.exited}</strong> 移出</span><span><strong>${payload.counts.same}</strong> 未变</span></div>
        ${mismatch.length ? `<div class="notice">${mismatch.join('；')}</div>` : ''}
        <div class="status-tabs">${[['changes', `变化 ${payload.counts.entered + payload.counts.exited}`], ['entered', `新增 ${payload.counts.entered}`], ['exited', `移出 ${payload.counts.exited}`], ['all', `全部 ${m.total}`]].map(([v, l]) => `<button data-action="member-status" data-value="${v}" class="${state.memberStatus === v ? 'active' : ''}">${l}</button>`).join('')}</div>
        <form id="member-form"><input class="search" name="memberQuery" placeholder="搜索成员名称，按 Enter" value="${esc(state.memberQuery)}"></form>
        <table class="rows-table"><thead><tr><th>名称</th><th>类型</th><th>基线</th><th>当前</th><th>状态</th></tr></thead><tbody>
        ${m.rows.map(r => `<tr><td class="mono">${esc(r.name)}${r.type === '目录' ? '/' : ''}</td><td>${r.type}</td><td>${r.b ? '✓' : '—'}</td><td>${r.c ? '✓' : '—'}</td><td>${r.status === 'entered' ? badge('新增', 'growth') : r.status === 'exited' ? badge('移出', 'decrease') : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">无匹配成员</td></tr>'}</tbody></table>
        <div class="mini-pagination"><span>${fmtInt(m.total)} 成员</span><div class="row"><button data-action="member-page" data-value="-1" ${m.page === 1 ? 'disabled' : ''}>←</button><span>${m.page} / ${m.pages}</span><button data-action="member-page" data-value="1" ${m.page === m.pages ? 'disabled' : ''}>→</button></div></div>`;
      return;
    }
    if (payload.kind === 'position') {
      region.innerHTML = `<h3 class="mono">${esc(payload.name)}</h3><p class="mono muted small">${esc(payload.path)}:${payload.line}</p>
        <div class="pair-values"><div><small>基线</small><strong>${payload.b ? '有记录' : '—'}</strong></div><span class="pair-arrow">→</span><div><small>当前</small><strong>${payload.c ? '有记录' : '—'}</strong></div></div>
        <div class="copy-block"><button class="text" data-action="copy" data-value="${esc(`${payload.path}:${payload.line}（${payload.name}）`)}">复制定位信息</button></div>`;
    }
  }

  async function refreshTable() {
    if (!scale.ready) return null;
    const generation = beginRequest('query');
    generations.evidence++;
    $('#table-region')?.setAttribute('aria-busy', 'true');
    if ($('#q-count')) $('#q-count').textContent = '正在查询，新条件尚未完成…';
    try {
      const t0 = performance.now();
      const payload = await send('query', {query: {
        type: state.type, metric: state.metric, directory: state.directory,
        search: state.search, status: state.status, sort: state.sort,
        page: state.page, pageSize: state.pageSize,
      }});
      if (!currentRequest('query', generation)) return {status: 'cancelled'};
      state.page = payload.page;
      renderStatusTabs(payload.counts);
      renderTable(payload);
      $('#table-region').removeAttribute('aria-busy');
      await twoRaf();
      if (!currentRequest('query', generation)) return {status: 'cancelled'};
      const elapsed = Math.round(performance.now() - t0);
      log({op: 'query', type: state.type, status: state.status, ms: elapsed, workerMs: payload.elapsedWorkerMs, total: payload.total});
      return {status: 'complete', elapsedMs: elapsed, workerMs: payload.elapsedWorkerMs, total: payload.total, pages: payload.pages, page: payload.page};
    } catch (error) {
      if (!currentRequest('query', generation)) return {status: 'cancelled'};
      $('#q-count').textContent = `查询失败：${error.message}`;
      $('#table-region').innerHTML = '<p class="notice">新条件未完成，请重试。</p>';
      $('#table-region').removeAttribute('aria-busy');
      return {status: 'failed', error: error.message};
    } finally { finishRequest('query', generation); }
  }

  async function refreshDirectories() {
    if (!scale.ready) return null;
    const generation = beginRequest('directories');
    try {
      const t0 = performance.now();
      const payload = await send('directories', {path: state.directory, search: state.dirSearch, page: state.dirPage, pageSize: 50});
      if (!currentRequest('directories', generation)) return {status: 'cancelled'};
      renderDirectories(payload);
      await twoRaf();
      if (!currentRequest('directories', generation)) return {status: 'cancelled'};
      const elapsed = Math.round(performance.now() - t0);
      log({op: 'directories', ms: elapsed, workerMs: payload.elapsedWorkerMs, total: payload.total});
      return {status: 'complete', elapsedMs: elapsed, workerMs: payload.elapsedWorkerMs, total: payload.total, page: payload.page, pages: payload.pages};
    } catch (error) {
      if (!currentRequest('directories', generation)) return {status: 'cancelled'};
      $('#dir-list').innerHTML = `<p class="notice">目录查询失败：${esc(error.message)}</p>`;
      return {status: 'failed', error: error.message};
    } finally { finishRequest('directories', generation); }
  }

  async function refreshEvidence() {
    const generation = beginRequest('evidence');
    try {
      if (!scale.ready || !state.selected) { renderEvidence(null); return null; }
      const t0 = performance.now();
      const selected = state.selected;
      const payload = await send('evidence', {rowId: selected, type: state.type, opts: {
        fragPage: state.fragPages, memberPage: state.memberPage, memberQuery: state.memberQuery, memberStatus: state.memberStatus,
      }});
      if (!currentRequest('evidence', generation) || state.selected !== selected) return {status: 'cancelled'};
      renderEvidence(payload);
      await twoRaf();
      if (!currentRequest('evidence', generation) || state.selected !== selected) return {status: 'cancelled'};
      const elapsed = Math.round(performance.now() - t0);
      log({op: 'evidence', ms: elapsed, workerMs: payload.elapsedWorkerMs});
      return {status: 'complete', elapsedMs: elapsed, workerMs: payload.elapsedWorkerMs};
    } catch (error) {
      if (!currentRequest('evidence', generation)) return {status: 'cancelled'};
      $('#evidence-region').innerHTML = `<p class="notice">证据查询失败：${esc(error.message)}</p>`;
      return {status: 'failed', error: error.message};
    } finally { finishRequest('evidence', generation); }
  }

  function renderView() {
    for (const channel of Object.keys(generations)) generations[channel]++;
    $('#header-region').innerHTML = headerHtml();
    $('#view').innerHTML = state.view === 'overview' ? overviewHtml() : '';
    if (state.view === 'workspace') { buildWorkspace(); renderTypeTabs(); renderStatusTabs(null); }
  }

  async function runVerify() {
    const region = state.view === 'overview' ? $('#verify-region') : null;
    if (state.view !== 'overview') { state.view = 'overview'; renderView(); }
    const target = $('#verify-region');
    target.innerHTML = '<p class="busy-note">正在核对汇总与明细一致性…</p>';
    const t0 = performance.now();
    const results = await send('verify');
    const failed = results.filter(r => !r.pass);
    target.innerHTML = `<section class="panel"><h3>自校验 ${failed.length ? `失败 ${failed.length} 项` : `通过 ${results.length} 项`}</h3>
      <p class="muted small">耗时 ${Math.round(performance.now() - t0)} ms。紧凑数组重算汇总并与生成端台账核对。</p>
      <details><summary>全部 ${results.length} 项</summary><table class="rows-table"><thead><tr><th>项</th><th>期望</th><th>实际</th></tr></thead><tbody>
      ${results.map(r => `<tr><td>${esc(r.name)}</td><td class="num">${fmtInt(r.expected)}</td><td class="num ${r.pass ? '' : 'up'}">${fmtInt(r.actual)}</td></tr>`).join('')}</tbody></table></details></section>`;
    log({op: 'verify', ms: Math.round(performance.now() - t0), failed: failed.length});
    window.scrollTo(0, 0);
    return {failed: failed.length, total: results.length};
  }

  function ensureWorkspace() {
    if (!$('#type-tabs')) { state.view = 'workspace'; renderView(); }
  }

  scale.run = async (action, patch) => {
    if (action === 'query') { Object.assign(state, patch); state.page = patch.page ?? 1; if (patch.resetSelection !== false) state.selected = null; ensureWorkspace(); renderTypeTabs(); return refreshTable(); }
    if (action === 'directories') { if ('path' in patch) state.directory = patch.path; if ('search' in patch) state.dirSearch = patch.search; state.dirPage = patch.dirPage ?? 1; ensureWorkspace(); return refreshDirectories(); }
    if (action === 'evidence') { state.selected = patch.rowId; Object.assign(state, {memberPage: 1, memberQuery: '', memberStatus: 'changes', fragPages: {}}); ensureWorkspace(); return refreshEvidence(); }
    if (action === 'verify') return runVerify();
    if (action === 'view') { state.view = patch.view; renderView(); if (patch.view === 'workspace') { renderTypeTabs(); await Promise.all([refreshDirectories(), refreshTable()]); } return null; }
    throw new Error(`未知 action：${action}`);
  };

  scale.bench = async (action, patch, times = 20) => {
    const samples = [];
    for (let i = 0; i < times; i++) samples.push(await scale.run(action, {...patch}));
    const sorted = samples.map(s => s.elapsedMs).sort((a, b) => a - b);
    const rank = q => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    return {times, p50: rank(0.5), p95: rank(0.95), min: sorted[0], max: sorted[sorted.length - 1], workerP95: samples.map(s => s.workerMs).sort((a, b) => a - b)[Math.ceil(0.95 * times) - 1], lastTotal: samples[samples.length - 1]?.total ?? null};
  };

  document.addEventListener('click', async event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action, value = target.dataset.value;
    if (action === 'copy') { await copyText(target.dataset.value || ''); return; }
    if (action === 'view') { state.view = value; renderView(); if (value === 'workspace') { renderTypeTabs(); refreshDirectories(); refreshTable(); } return; }
    if (action === 'verify') { runVerify(); return; }
    if (action === 'metric-card') {
      const link = METRIC_LINK[value];
      if (!link) return;
      state.view = 'workspace'; state.type = link.type; state.metric = link.metric || 'lines';
      state.directory = ''; state.search = ''; state.status = 'changes'; state.sort = 'delta-desc'; state.page = 1; state.selected = null;
      renderView(); renderTypeTabs();
      refreshDirectories(); refreshTable(); return;
    }
    if (action === 'type') { state.type = value; state.metric = value === 'methods' ? state.metric : 'lines'; state.status = 'changes'; state.page = 1; state.selected = null; renderTypeTabs(); refreshTable(); return; }
    if (action === 'status') { state.status = value; state.page = 1; refreshTable(); return; }
    if (action === 'page') { state.page += Number(value); refreshTable(); return; }
    if (action === 'select') { state.selected = value; state.fragPages = {}; state.memberPage = 1; state.memberQuery = ''; state.memberStatus = 'changes'; document.querySelectorAll('#table-region tr.selected').forEach(tr => tr.classList.remove('selected')); target.closest('tr')?.classList.add('selected'); refreshEvidence(); return; }
    if (action === 'dir-open') { state.directory = value; state.dirPage = 1; state.dirSearch = ''; $('#dir-search').value = ''; state.page = 1; refreshDirectories(); refreshTable(); return; }
    if (action === 'dir-crumb') { state.directory = value; state.dirPage = 1; refreshDirectories(); refreshTable(); return; }
    if (action === 'dir-page') { state.dirPage += Number(value); refreshDirectories(); return; }
    if (action === 'reset') {
      Object.assign(state, {type: 'files', metric: 'lines', directory: '', search: '', status: 'changes', sort: 'delta-desc', page: 1, selected: null});
      $('#q-search').value = ''; $('#metric-select').value = 'lines'; $('#sort-select').value = 'delta-desc';
      renderTypeTabs(); refreshDirectories(); refreshTable(); return;
    }
    if (action === 'ev-frag') {
      const key = target.dataset.key;
      state.fragPages[key] = Math.max(1, (state.fragPages[key] || 1) + Number(value));
      refreshEvidence(); return;
    }
    if (action === 'member-status') { state.memberStatus = value; state.memberPage = 1; refreshEvidence(); return; }
    if (action === 'member-page') { state.memberPage += Number(value); refreshEvidence(); return; }
  });

  document.addEventListener('submit', event => {
    if (event.target.id !== 'member-form') return;
    event.preventDefault();
    state.memberQuery = new FormData(event.target).get('memberQuery') || '';
    state.memberPage = 1;
    refreshEvidence();
  });

  function wireWorker() {
    worker.onmessage = event => {
      const msg = event.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.type === 'error') entry.reject(new Error(msg.message));
      else entry.resolve(msg.type === 'result' ? msg.payload : msg);
    };
    worker.onerror = error => {
      for (const entry of pending.values()) entry.reject(new Error(`Worker 异常：${error.message}`));
      pending.clear();
    };
  }

  async function boot() {
    const params = new URLSearchParams(location.search);
    META = JSON.parse($('#scale-meta').textContent);
    metrics.meta = {scale: META.scale};
    if (params.get('failInit') === '1') throw new Error('模拟初始化失败');
    const source = $('#scale-worker').textContent;
    $('#scale-worker').remove();
    worker = new Worker(URL.createObjectURL(new Blob([source], {type: 'text/javascript'})));
    wireWorker();
    const status = $('#init-status');
    status.textContent = '正在解压与加载数据…';
    const ready = await loadBlocks();
    scale.ready = true;
    status.textContent = `数据就绪：${fmtInt(ready.stats.files)} 并集文件，${fmtInt(ready.stats.methodsB)}+${fmtInt(ready.stats.methodsC)} 函数，索引 ${ready.stats.initMs} ms。`;
    state.view = params.get('view') === 'workspace' ? 'workspace' : 'overview';
    document.documentElement.classList.add('interactive-ready');
    $('#app').innerHTML = '<div id="header-region"></div><div id="verify-region"></div><main id="view"></main>';
    renderView();
    if (state.view === 'workspace') { renderTypeTabs(); refreshDirectories(); refreshTable(); }
    document.title = 'Cmetrics / 大数据容量验证原型';
  }

  boot().catch(error => {
    console.error(error);
    const status = $('#init-status');
    if (status) status.textContent = `交互不可用，仅显示静态概览。${error.message}`;
  });
})();
