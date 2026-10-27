/* 大数据容量验证原型 Worker：解码 gzip 分块，构建紧凑索引，单遍扫描 + top-K 查询。
 * 状态只保存在 Worker；主线程仅收发消息与渲染当前页。一次性原型，不代表正式实现。 */
'use strict';

const S = {
  meta: null, paths: null, F: 0, names: null,
  files: null, dirs: null, dirByPath: null,
  mB: null, mC: null, rangeB: null, rangeC: null,
  frag: null, fragIndex: null, groupTotals: null, groupFragIdx: null,
  dup: null, unsafe: null, redundant: null,
  ready: false,
};

async function gunzip(b64) {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function parseBin(view) {
  const buffer = view.buffer;
  const headerLen = new DataView(buffer, view.byteOffset, view.byteLength).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, view.byteOffset + 4, headerLen)));
  let dataStart = view.byteOffset + 4 + headerLen;
  dataStart += (4 - (dataStart % 4)) % 4;
  const views = {};
  for (const [name, spec] of Object.entries(header.a)) {
    const Type = spec.t === 'u8' ? Uint8Array : spec.t === 'i32' ? Int32Array : Uint32Array;
    views[name] = new Type(buffer, dataStart + spec.o, spec.n);
  }
  return { views, count: header.n || 0 };
}

function textOf(bytes) {
  return new TextDecoder().decode(bytes);
}

const LOAD_HANDLERS = {
  meta(bytes) { S.meta = JSON.parse(textOf(bytes)); },
  paths(bytes) { S.paths = textOf(bytes).split('\n'); S.F = S.paths.length; },
  names(bytes) { S.names = textOf(bytes).split('\n'); },
  files(bytes) { S.files = parseBin(bytes).views; },
  dirs(bytes) {
    const parsed = JSON.parse(textOf(bytes));
    S.dirs = Array.isArray(parsed) ? parsed : parsed.list;
    S.dirByPath = new Map(S.dirs.map((d, i) => [d.p, i]));
  },
  methodsB(bytes) { S.mB = parseBin(bytes); },
  methodsC(bytes) { S.mC = parseBin(bytes); },
  fragB(bytes) { S.frag = S.frag || {}; S.frag.baseline = parseBin(bytes).views; },
  fragC(bytes) { S.frag = S.frag || {}; S.frag.current = parseBin(bytes).views; },
  dupfilesB(bytes) { S.dup = S.dup || {}; S.dup.baseline = JSON.parse(textOf(bytes)); },
  dupfilesC(bytes) { S.dup = S.dup || {}; S.dup.current = JSON.parse(textOf(bytes)); },
  unsafeB(bytes) { S.unsafe = S.unsafe || {}; S.unsafe.baseline = parseBin(bytes).views; },
  unsafeC(bytes) { S.unsafe = S.unsafe || {}; S.unsafe.current = parseBin(bytes).views; },
  redundantB(bytes) { S.redundant = S.redundant || {}; S.redundant.baseline = parseBin(bytes).views; },
  redundantC(bytes) { S.redundant = S.redundant || {}; S.redundant.current = parseBin(bytes).views; },
};

function buildDerived() {
  const F = S.F;
  // 每侧按文件聚集的函数区间：range[f]..range[f+1)（构建器已按 fileId+起始行排序）。
  for (const [methods, key] of [[S.mB, 'rangeB'], [S.mC, 'rangeC']]) {
    const range = new Uint32Array(F + 1);
    for (let i = 0; i < methods.count; i++) range[methods.views.fi[i] + 1]++;
    for (let f = 1; f <= F; f++) range[f] += range[f - 1];
    S[key] = range;
  }
  // 重复片段倒排：fileId -> [{side,g,s,l}]；组员索引与组总量。
  S.fragIndex = new Map();
  S.groupTotals = {};
  S.groupFragIdx = {};
  for (const side of ['baseline', 'current']) {
    const frag = S.frag[side];
    const groups = S.meta.groups[side];
    const totals = new Uint32Array(groups.length);
    const members = Array.from({ length: groups.length }, () => []);
    for (let i = 0; i < frag.g.length; i++) {
      totals[frag.g[i]]++;
      members[frag.g[i]].push(i);
      const list = S.fragIndex.get(frag.f[i]);
      const item = { side, g: frag.g[i], s: frag.s[i], l: frag.l[i] };
      if (list) list.push(item); else S.fragIndex.set(frag.f[i], [item]);
    }
    S.groupTotals[side] = totals;
    S.groupFragIdx[side] = members;
  }
  // 整文件重复成员标记。
  S.dupMember = {};
  for (const side of ['baseline', 'current']) {
    const flag = new Uint8Array(F);
    for (const group of S.dup[side]) for (const f of group.m) flag[f] = 1;
    S.dupMember[side] = flag;
  }
}

function scopeRange(directory) {
  if (!directory) return [0, S.F];
  const prefix = `${directory}/`;
  let lo = 0, hi = S.F;
  while (lo < hi) { const mid = (lo + hi) >> 1; S.paths[mid] < prefix ? (lo = mid + 1) : (hi = mid); }
  let end = lo;
  while (end < S.F && S.paths[end].startsWith(prefix)) end++;
  return [lo, end];
}

function classify(bEx, cEx, bVal, cVal, ambiguous) {
  const flags = [];
  if (ambiguous) flags.push('ambiguous');
  else if (bVal == null && cVal == null) flags.push('unknown');
  if (!bEx && cEx) flags.push('entered');
  else if (bEx && !cEx) flags.push('exited');
  else if (!ambiguous && bVal != null && cVal != null) {
    if (cVal > bVal) flags.push('growth');
    else if (cVal < bVal) flags.push('decrease');
    else flags.push('unchanged');
  } else if (bEx && cEx && !flags.includes('ambiguous')) flags.push('unchanged');
  return flags;
}

function changed(flags) {
  return flags.some(f => f === 'entered' || f === 'exited' || f === 'growth' || f === 'decrease');
}

function matchesStatus(flags, status) {
  if (status === 'all') return true;
  if (status === 'changes') return changed(flags);
  return flags.includes(status);
}

function makeSorter(sort) {
  const dir = sort.endsWith('-asc') ? 1 : -1;
  if (sort.startsWith('path')) return (a, b) => a.path < b.path ? -dir : a.path > b.path ? dir : 0;
  if (sort.startsWith('current')) {
    return (a, b) => ((a.c ?? -Infinity) - (b.c ?? -Infinity)) * dir || (a.path < b.path ? -1 : 1);
  }
  return (a, b) => ((a.delta ?? 0) - (b.delta ?? 0)) * dir || (a.path < b.path ? -1 : 1);
}

function insertTopK(rows, row, cmp, K) {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; cmp(rows[mid], row) <= 0 ? (lo = mid + 1) : (hi = mid); }
  rows.splice(lo, 0, row);
  if (rows.length > K) rows.pop();
}

function newCounters() {
  return { changes: 0, growth: 0, decrease: 0, unchanged: 0, entered: 0, exited: 0, ambiguous: 0, all: 0 };
}

function bump(counters, flags) {
  counters.all++;
  if (changed(flags)) counters.changes++;
  for (const f of ['growth', 'decrease', 'unchanged', 'entered', 'exited', 'ambiguous']) {
    if (flags.includes(f)) counters[f]++;
  }
}

function fileBaseRow(f, bVal, cVal, flags, kind) {
  const path = S.paths[f];
  return {
    id: `f:${f}`, kind: kind || 'file', path, name: path.slice(path.lastIndexOf('/') + 1),
    b: bVal, c: cVal, delta: (cVal ?? 0) - (bVal ?? 0), flags,
  };
}

function runQuery(q) {
  const [lo, hi] = scopeRange(q.directory);
  const qs = (q.search || '').trim().toLowerCase();
  const K = Math.min(q.pageSize || 50, 200);
  const requestedPage = Math.max(1, Math.min(q.page || 1, 50));
  const cap = K * requestedPage;
  const cmp = makeSorter(q.sort || 'delta-desc');
  const counters = newCounters();
  const top = [];
  const match = (row) => { bump(counters, row.flags); if (matchesStatus(row.flags, q.status)) insertTopK(top, row, cmp, cap); };
  const type = q.type;
  if (type === 'files' || type === 'duplication') {
    const useDup = type === 'duplication' || q.metric === 'dup';
    for (let f = lo; f < hi; f++) {
      if (qs && !S.paths[f].toLowerCase().includes(qs)) continue;
      const bEx = S.files.bEx[f], cEx = S.files.cEx[f];
      const bVal = bEx ? (useDup ? S.files.bD[f] : S.files.bN[f]) : null;
      const cVal = cEx ? (useDup ? S.files.cD[f] : S.files.cN[f]) : null;
      match(fileBaseRow(f, bVal, cVal, classify(bEx, cEx, bVal, cVal, false)));
    }
  } else if (type === 'methods') {
    const useCc = q.metric === 'cc';
    for (let f = lo; f < hi; f++) {
      if (qs && !S.paths[f].toLowerCase().includes(qs)) continue;
      const bEx = S.files.bEx[f], cEx = S.files.cEx[f];
      if (!bEx && !cEx) continue;
      const bStart = S.rangeB[f], bEnd = S.rangeB[f + 1];
      const cStart = S.rangeC[f], cEnd = S.rangeC[f + 1];
      const names = new Map();
      for (let i = bStart; i < bEnd; i++) {
        const na = S.mB.views.na[i];
        names.has(na) || names.set(na, { b: [], c: [] });
        names.get(na).b.push(i);
      }
      for (let i = cStart; i < cEnd; i++) {
        const na = S.mC.views.na[i];
        names.has(na) || names.set(na, { b: [], c: [] });
        names.get(na).c.push(i);
      }
      for (const [na, slots] of names) {
        const ambiguous = slots.b.length > 1 || slots.c.length > 1;
        const pick = (side, i) => {
          if (i == null) return null;
          return useCc ? side.cc[i] : side.ln[i];
        };
        const bVal = ambiguous ? null : pick(S.mB.views, slots.b[0]);
        const cVal = ambiguous ? null : pick(S.mC.views, slots.c[0]);
        const flags = classify(slots.b.length > 0, slots.c.length > 0, bVal, cVal, ambiguous);
        const path = S.paths[f];
        const row = {
          id: `m:${f}:${na}`, kind: 'method', path, name: S.names[na],
          b: bVal, c: cVal, delta: ambiguous ? null : (cVal ?? 0) - (bVal ?? 0), flags,
        };
        match(row);
      }
    }
  } else if (type === 'dupfiles') {
    for (let f = lo; f < hi; f++) {
      if (qs && !S.paths[f].toLowerCase().includes(qs)) continue;
      const bEx = !!S.dupMember.baseline[f], cEx = !!S.dupMember.current[f];
      if (!bEx && !cEx) continue;
      match(fileBaseRow(f, bEx ? 1 : null, cEx ? 1 : null, classify(bEx, cEx, bEx ? 1 : null, cEx ? 1 : null, false)));
    }
  } else if (type === 'unsafe' || type === 'redundant') {
    const merged = new Map();
    for (const side of ['baseline', 'current']) {
      const rows = type === 'unsafe' ? S.unsafe[side] : S.redundant[side];
      for (let i = 0; i < rows.f.length; i++) {
        const f = rows.f[i];
        if (f < lo || f >= hi) continue;
        if (qs && !S.paths[f].toLowerCase().includes(qs)) continue;
        const key = type === 'unsafe' ? `${f}:${rows.na[i]}:${rows.ln[i]}` : `${f}:${rows.ln[i]}`;
        const slot = merged.get(key) || { f, na: type === 'unsafe' ? rows.na[i] : -1, ln: rows.ln[i], b: false, c: false };
        slot[side === 'baseline' ? 'b' : 'c'] = true;
        merged.set(key, slot);
      }
    }
    for (const slot of merged.values()) {
      const flags = classify(slot.b, slot.c, slot.b ? 1 : null, slot.c ? 1 : null, false);
      const path = S.paths[slot.f];
      const row = {
        id: type === 'unsafe' ? `u:${slot.f}:${slot.na}:${slot.ln}` : `r:${slot.f}:${slot.ln}`,
        kind: 'position', path, name: slot.na >= 0 ? S.names[slot.na] : path.slice(path.lastIndexOf('/') + 1),
        b: slot.b ? 1 : null, c: slot.c ? 1 : null, delta: (slot.c ? 1 : 0) - (slot.b ? 1 : 0), flags,
      };
      match(row);
    }
  } else if (type === 'folders') {
    const dirPrefix = q.directory ? `${q.directory}/` : '';
    for (let i = 0; i < S.dirs.length; i++) {
      const d = S.dirs[i];
      if (d.kB == null && d.kC == null) continue;
      if (dirPrefix && !(d.p + '/').startsWith(dirPrefix) && d.p !== q.directory) continue;
      if (qs && !d.p.toLowerCase().includes(qs)) continue;
      const measuredB = measuredMembers(i, 'baseline'), measuredC = measuredMembers(i, 'current');
      const bVal = d.kB ?? measuredB, cVal = d.kC ?? measuredC;
      const flags = classify(d.kB != null, d.kC != null, bVal, cVal, false);
      match({ id: `d:${i}`, kind: 'folder', path: d.p, name: d.p.slice(d.p.lastIndexOf('/') + 1) || d.p, b: bVal, c: cVal, delta: (cVal ?? 0) - (bVal ?? 0), flags });
    }
  } else {
    throw new Error(`不支持的查询类型：${type}`);
  }
  const statusTotal = q.status === 'all' ? counters.all : (counters[q.status] ?? counters.all);
  const pages = Math.max(1, Math.ceil(statusTotal / K));
  const clamped = Math.max(1, Math.min(q.page || 1, pages));
  return {
    rows: top.slice((clamped - 1) * K, clamped * K),
    total: statusTotal, pages, page: clamped,
    counts: counters, scopeCount: hi - lo,
    scope: scopeSummary(lo, hi),
  };
}

function scopeSummary(lo, hi) {
  let filesB = 0, filesC = 0, codeB = 0, codeC = 0;
  for (let f = lo; f < hi; f++) {
    if (S.files.bEx[f]) { filesB++; codeB += S.files.bN[f]; }
    if (S.files.cEx[f]) { filesC++; codeC += S.files.cN[f]; }
  }
  return { filesB, filesC, codeB, codeC };
}

function measuredMembers(dirIdx, side) {
  const d = S.dirs[dirIdx];
  const exFlag = side === 'baseline' ? 'bEx' : 'cEx';
  const countFlag = side === 'baseline' ? 'bF' : 'cF';
  let n = 0;
  for (const f of d.cf) if (S.files[exFlag][f]) n++;
  for (const c of d.cd) if (S.dirs[c][countFlag] > 0) n++;
  return n;
}

function runDirectories(req) {
  const pageSize = Math.min(req.pageSize || 50, 200);
  const qs = (req.search || '').trim().toLowerCase();
  let rows = [];
  if (qs) {
    for (let i = 0; i < S.dirs.length; i++) {
      if (S.dirs[i].p && S.dirs[i].p.toLowerCase().includes(qs)) rows.push(i);
    }
    rows.sort((a, b) => S.dirs[a].p < S.dirs[b].p ? -1 : 1);
  } else {
    const idx = S.dirByPath.get(req.path || '') ?? 0;
    rows = S.dirs[idx].cd.slice().sort((a, b) => {
      const na = S.dirs[a].p.slice(S.dirs[a].p.lastIndexOf('/') + 1);
      const nb = S.dirs[b].p.slice(S.dirs[b].p.lastIndexOf('/') + 1);
      return na < nb ? -1 : na > nb ? 1 : 0;
    });
  }
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.max(1, Math.min(req.page || 1, pages));
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const payloadRows = slice.map(i => {
    const d = S.dirs[i];
    return {
      idx: i, path: d.p, name: d.p.slice(d.p.lastIndexOf('/') + 1) || d.p, depth: d.dep,
      bFiles: d.bF, cFiles: d.cF, bCode: d.bC, cCode: d.cC,
      childCount: d.cd.length + d.cf.length, kB: d.kB ?? null, kC: d.kC ?? null,
      measuredB: measuredMembers(i, 'baseline'), measuredC: measuredMembers(i, 'current'),
    };
  });
  const current = S.dirs[S.dirByPath.get(req.path || '') ?? 0];
  const crumbs = [];
  let walk = S.dirByPath.get(req.path || '') ?? 0;
  while (walk != null) { crumbs.unshift({ path: S.dirs[walk].p, name: S.dirs[walk].p.slice(S.dirs[walk].p.lastIndexOf('/') + 1) || '全部' }); walk = S.dirs[walk].par; }
  return {
    rows: payloadRows, total: rows.length, pages, page, crumbs,
    scope: { filesB: current.bF, filesC: current.cF, codeB: current.bC, codeC: current.cC },
  };
}

function methodRecords(side, f) {
  const methods = side === 'baseline' ? S.mB : S.mC;
  const range = side === 'baseline' ? S.rangeB : S.rangeC;
  const out = [];
  for (let i = range[f]; i < range[f + 1]; i++) {
    out.push({ name: S.names[methods.views.na[i]], start: methods.views.st[i], end: methods.views.en[i], lines: methods.views.ln[i], cc: methods.views.cc[i] });
  }
  return out;
}

function runEvidence(req) {
  const id = req.rowId;
  const pageSize = 30;
  if (id.startsWith('f:')) {
    const f = Number(id.slice(2));
    const fragList = S.fragIndex.get(f) || [];
    const groups = [];
    const seen = new Set();
    for (const item of fragList) {
      const key = `${item.side}:${item.g}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const memberIdx = S.groupFragIdx[item.side][item.g];
      const page = Math.max(1, Math.min(req.opts?.fragPage?.[key] || 1, Math.max(1, Math.ceil(memberIdx.length / pageSize))));
      const slice = memberIdx.slice((page - 1) * pageSize, page * pageSize);
      const frag = S.frag[item.side];
      groups.push({
        side: item.side, label: item.side === 'baseline' ? '基线' : '当前', groupId: S.meta.groups[item.side][item.g],
        total: memberIdx.length, page, pages: Math.max(1, Math.ceil(memberIdx.length / pageSize)),
        members: slice.map(i => ({ path: S.paths[frag.f[i]], start: frag.s[i], len: frag.l[i], self: frag.f[i] === f })),
      });
    }
    const dupGroups = [];
    for (const side of ['baseline', 'current']) {
      for (const group of S.dup[side]) {
        const at = group.m.indexOf(f);
        if (at < 0) continue;
        const page = Math.max(1, Math.min(req.opts?.fragPage?.[`dup:${side}:${group.id}`] || 1, Math.max(1, Math.ceil(group.m.length / pageSize))));
        dupGroups.push({ side, label: side === 'baseline' ? '基线' : '当前', groupId: group.id, total: group.m.length, page, pages: Math.max(1, Math.ceil(group.m.length / pageSize)), members: group.m.slice((page - 1) * pageSize, page * pageSize).map(m => ({ path: S.paths[m], self: m === f })) });
      }
    }
    const unsafeRows = [];
    for (const side of ['baseline', 'current']) {
      const rows = S.unsafe[side];
      for (let i = 0; i < rows.f.length; i++) {
        if (rows.f[i] !== f) continue;
        const key = `${rows.na[i]}:${rows.ln[i]}`;
        let slot = unsafeRows.find(r => r.key === key);
        if (!slot) { slot = { key, name: S.names[rows.na[i]], line: rows.ln[i], b: false, c: false }; unsafeRows.push(slot); }
        slot[side === 'baseline' ? 'b' : 'c'] = true;
      }
    }
    unsafeRows.sort((a, b) => a.line - b.line);
    const redundantRows = [];
    for (const side of ['baseline', 'current']) {
      const rows = S.redundant[side];
      for (let i = 0; i < rows.f.length; i++) {
        if (rows.f[i] !== f) continue;
        let slot = redundantRows.find(r => r.line === rows.ln[i]);
        if (!slot) { slot = { line: rows.ln[i], b: false, c: false }; redundantRows.push(slot); }
        slot[side === 'baseline' ? 'b' : 'c'] = true;
      }
    }
    return {
      kind: 'file', path: S.paths[f], existsB: !!S.files.bEx[f], existsC: !!S.files.cEx[f],
      file: {
        bN: S.files.bEx[f] ? S.files.bN[f] : null, cN: S.files.cEx[f] ? S.files.cN[f] : null,
        bR: S.files.bEx[f] ? S.files.bR[f] : null, cR: S.files.cEx[f] ? S.files.cR[f] : null,
        bD: S.files.bEx[f] ? S.files.bD[f] : null, cD: S.files.cEx[f] ? S.files.cD[f] : null,
      },
      methodsB: methodRecords('baseline', f), methodsC: methodRecords('current', f),
      fragGroups: groups, dupGroups, unsafeRows, redundantRows,
    };
  }
  if (id.startsWith('m:')) {
    const [, fRaw, naRaw] = id.split(':');
    const f = Number(fRaw), na = Number(naRaw);
    const collect = side => {
      const methods = side === 'baseline' ? S.mB : S.mC;
      const range = side === 'baseline' ? S.rangeB : S.rangeC;
      const out = [];
      for (let i = range[f]; i < range[f + 1]; i++) if (methods.views.na[i] === na) {
        out.push({ start: methods.views.st[i], end: methods.views.en[i], lines: methods.views.ln[i], cc: methods.views.cc[i] });
      }
      return out;
    };
    const b = collect('baseline'), c = collect('current');
    return { kind: 'method', path: S.paths[f], name: S.names[na], ambiguous: b.length > 1 || c.length > 1, recordsB: b, recordsC: c };
  }
  if (id.startsWith('d:')) {
    const idx = Number(id.slice(2));
    const d = S.dirs[idx];
    const all = [];
    for (const c of d.cd) all.push({ name: S.dirs[c].p.slice(S.dirs[c].p.lastIndexOf('/') + 1), path: S.dirs[c].p, type: '目录', b: S.dirs[c].bF > 0, c: S.dirs[c].cF > 0 });
    for (const f of d.cf) all.push({ name: S.paths[f].slice(S.paths[f].lastIndexOf('/') + 1), path: S.paths[f], type: '文件', b: !!S.files.bEx[f], c: !!S.files.cEx[f] });
    for (const m of all) m.status = m.b && m.c ? 'same' : m.c ? 'entered' : 'exited';
    const mq = (req.opts?.memberQuery || '').trim().toLowerCase();
    const status = req.opts?.memberStatus || 'changes';
    const filtered = all.filter(m => (!mq || m.name.toLowerCase().includes(mq)) && (status === 'all' || (status === 'changes' ? m.status !== 'same' : m.status === status)));
    const pageSize = Math.min(req.opts?.memberPageSize || 50, 200);
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.max(1, Math.min(req.opts?.memberPage || 1, pages));
    return {
      kind: 'folder', path: d.p,
      declaredB: d.kB ?? null, declaredC: d.kC ?? null,
      measuredB: measuredMembers(idx, 'baseline'), measuredC: measuredMembers(idx, 'current'),
      counts: { entered: all.filter(m => m.status === 'entered').length, exited: all.filter(m => m.status === 'exited').length, same: all.filter(m => m.status === 'same').length },
      members: { rows: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, pages, page },
    };
  }
  if (id.startsWith('u:') || id.startsWith('r:')) {
    const unsafe = id.startsWith('u:');
    const parts = id.split(':');
    const f = Number(parts[1]);
    let b = false, c = false;
    for (const side of ['baseline', 'current']) {
      const rows = unsafe ? S.unsafe[side] : S.redundant[side];
      for (let i = 0; i < rows.f.length; i++) {
        if (rows.f[i] !== f) continue;
        const hit = unsafe ? rows.na[i] === Number(parts[2]) && rows.ln[i] === Number(parts[3]) : rows.ln[i] === Number(parts[2]);
        if (hit) { side === 'baseline' ? (b = true) : (c = true); break; }
      }
    }
    return { kind: 'position', path: S.paths[f], name: unsafe ? S.names[Number(parts[2])] : '冗余代码', line: Number(parts[unsafe ? 3 : 2]), b, c };
  }
  throw new Error(`无法识别的对象：${id}`);
}

function runVerify() {
  const out = [];
  const check = (name, expected, actual) => out.push({ name, pass: expected === actual, expected, actual });
  const sum = (arr, flag, n) => { let s = 0; for (let f = 0; f < S.F; f++) if (flag[f]) s += arr[f]; return s; };
  const sb = S.meta.summaries.baseline, sc = S.meta.summaries.current;
  check('基线 code_size = Σ文件行', sb.code_size, sum(S.files.bN, S.files.bEx, S.F));
  check('当前 code_size = Σ文件行', sc.code_size, sum(S.files.cN, S.files.cEx, S.F));
  check('基线函数数', sb.methods_total, S.mB.count);
  check('当前函数数', sc.methods_total, S.mC.count);
  let mb = 0, ccb = 0, mc = 0, ccc = 0, maxB = 0, maxC = 0;
  for (let i = 0; i < S.mB.count; i++) { mb += S.mB.views.ln[i]; ccb += S.mB.views.cc[i]; if (S.mB.views.cc[i] > maxB) maxB = S.mB.views.cc[i]; }
  for (let i = 0; i < S.mC.count; i++) { mc += S.mC.views.ln[i]; ccc += S.mC.views.cc[i]; if (S.mC.views.cc[i] > maxC) maxC = S.mC.views.cc[i]; }
  check('基线 method_lines', sb.method_lines, mb);
  check('当前 method_lines', sc.method_lines, mc);
  check('基线复杂度总量', sb.cyclomatic_complexity_total, ccb);
  check('当前复杂度总量', sc.cyclomatic_complexity_total, ccc);
  check('基线最大复杂度', sb.maximum_cyclomatic_complexity, maxB);
  check('当前最大复杂度', sc.maximum_cyclomatic_complexity, maxC);
  check('基线重复行总量', sb.code_duplication_total, sum(S.files.bD, S.files.bEx, S.F));
  check('当前重复行总量', sc.code_duplication_total, sum(S.files.cD, S.files.cEx, S.F));
  let dupB = 0, dupC = 0;
  for (let f = 0; f < S.F; f++) { if (S.dupMember.baseline[f]) dupB++; if (S.dupMember.current[f]) dupC++; }
  check('基线整文件重复数', sb.file_duplication_total, dupB);
  check('当前整文件重复数', sc.file_duplication_total, dupC);
  check('基线危险位置数', sb.unsafe_functions_total, S.unsafe.baseline.f.length);
  check('当前危险位置数', sc.unsafe_functions_total, S.unsafe.current.f.length);
  check('基线冗余块数', sb.redundant_code_total, S.redundant.baseline.f.length);
  check('当前冗余块数', sc.redundant_code_total, S.redundant.current.f.length);
  let foldersB = 0, foldersC = 0, hugeB = 0, hugeC = 0;
  for (const d of S.dirs) { if (d.bF > 0) foldersB++; if (d.cF > 0) foldersC++; if (d.kB != null) hugeB++; if (d.kC != null) hugeC++; }
  check('基线目录数', sb.folders_total, foldersB);
  check('当前目录数', sc.folders_total, foldersC);
  check('基线超大目录数', sb.huge_folder_total, hugeB);
  check('当前超大目录数', sc.huge_folder_total, hugeC);
  const mf = S.meta.manifest;
  if (mf) {
    let added = 0, removed = 0, modified = 0;
    for (let f = 0; f < S.F; f++) {
      if (!S.files.bEx[f] && S.files.cEx[f]) added++;
      else if (S.files.bEx[f] && !S.files.cEx[f]) removed++;
      else if (S.files.bEx[f] && S.files.cEx[f] && (S.files.bN[f] !== S.files.cN[f] || S.files.bR[f] !== S.files.cR[f] || S.files.bD[f] !== S.files.cD[f])) modified++;
    }
    check('并集文件数 = 台账', mf.unionFiles, S.F);
    check('新增文件数 = 台账', mf.addedFiles, added);
    check('移出文件数 = 台账', mf.removedFiles, removed);
    check('修改存续文件数 = 台账', mf.modifiedSharedFiles, modified);
  }
  return out;
}

self.onmessage = async event => {
  const msg = event.data;
  const started = performance.now();
  try {
    if (msg.op === 'load') {
      const bytes = await gunzip(msg.b64);
      LOAD_HANDLERS[msg.kind](bytes);
      self.postMessage({ type: 'loaded', id: msg.id, kind: msg.kind, ms: Math.round(performance.now() - started) });
      return;
    }
    if (msg.op === 'finish') {
      const t0 = performance.now();
      buildDerived();
      S.ready = true;
      self.postMessage({
        type: 'ready', id: msg.id,
        stats: {
          files: S.F, dirs: S.dirs.length, methodsB: S.mB.count, methodsC: S.mC.count,
          initMs: Math.round(performance.now() - t0),
        },
      });
      return;
    }
    if (!S.ready) throw new Error('数据尚未就绪');
    let payload = null;
    if (msg.op === 'query') payload = runQuery(msg.query);
    else if (msg.op === 'directories') payload = runDirectories(msg);
    else if (msg.op === 'evidence') payload = runEvidence(msg);
    else if (msg.op === 'verify') payload = runVerify();
    else throw new Error(`未知操作：${msg.op}`);
    payload.elapsedWorkerMs = Math.round(performance.now() - started);
    self.postMessage({ type: 'result', id: msg.id, op: msg.op, payload, workerMs: payload.elapsedWorkerMs });
  } catch (error) {
    self.postMessage({ type: 'error', id: msg.id, op: msg.op, message: String(error && error.message || error) });
  }
};
