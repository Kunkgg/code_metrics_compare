/* 容量原型查询契约：执行生成物内真实 Worker，通过消息接口检查独立输入预期。
 * Node 22+；不模拟查询实现。--allow-known-failures 仅用于冻结现有失败基线。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {loadWorker} = require('./worker-harness.cjs');
const crypto = require('node:crypto');

(async () => {
  const [inputDir, reportPath, ...flags] = process.argv.slice(2);
  if (!inputDir || !reportPath) throw new Error('用法：node check-capacity-contract.cjs 输入目录 HTML [--allow-known-failures]');
  const html = fs.readFileSync(reportPath, 'utf8');
  const {send,source} = await loadWorker(html,'scale-worker');
  const reports = Object.fromEntries(['baseline', 'current'].map(side => [side, JSON.parse(fs.readFileSync(path.join(inputDir, `${side}.json`), 'utf8'))]));
  const manifest = JSON.parse(fs.readFileSync(path.join(inputDir, 'manifest.json'), 'utf8'));
  const prefix = `${manifest.root}/`;
  const relative = value => {
    if (!value.startsWith(prefix)) throw new Error(`输入路径不在 manifest 根内：${value}`);
    return value.slice(prefix.length);
  };
  const paths = [...new Set(Object.values(reports).flatMap(r => Object.keys(r.detail_metrics.file_sizes).map(relative)))].sort();
  if (paths.length < 51) throw new Error('深页夹具至少需要 51 个并集文件');
  const known = new Set(['capacity.page51', 'capacity.last-page', 'capacity.method-name', 'capacity.unsafe-name', 'capacity.fragment-page-key', 'capacity.default-ambiguity']);
  const allowKnown = flags.includes('--allow-known-failures');
  const checks = [];
  const check = (id, expected, actual, knownActual) => {
    const equal = JSON.stringify(expected) === JSON.stringify(actual);
    const reproducesKnown = JSON.stringify(actual) === JSON.stringify(knownActual);
    const status = allowKnown && known.has(id) ? (equal ? 'unexpected-pass' : reproducesKnown ? 'known-failure' : 'fail') : (equal ? 'pass' : 'fail');
    checks.push({id, status, expected, actual});
  };
  const query = patch => send({op: 'query', query: {type: 'files', status: 'all', sort: 'path-asc', pageSize: 1, page: 1, ...patch}});
  for (const [name, page] of [['first-page', 1], ['page50', 50], ['page51', 51], ['last-page', paths.length]]) {
    const result = await query({page});
    check(`capacity.${name}`, {total: paths.length, page, paths: [paths[page - 1]]}, {total: result.total, page: result.page, paths: result.rows.map(r => r.path)}, {total: paths.length, page, paths: []});
  }
  const noMatch = await query({search: '__cmetrics_absent_7fa94__'});
  check('capacity.absent-search', {total: 0, rows: 0}, {total: noMatch.total, rows: noMatch.rows.length});

  // 预期按原始记录的路径＋名称独立分组，不使用 Worker 的列或运行结果生成答案。
  const methods = new Map();
  for (const side of ['baseline', 'current']) {
    for (const method of reports[side].detail_metrics.method_metrics) {
      if (!Object.hasOwn(method, 'file_name')) continue;
      const rel = relative(method.file_name), key = JSON.stringify([rel, method.method_name]);
      if (!methods.has(key)) methods.set(key, {path: rel, name: method.method_name, baseline: [], current: []});
      methods.get(key)[side].push(method);
    }
  }
  const methodName = [...methods.values()].find(row => !paths.some(p => p.toLowerCase().includes(row.name.toLowerCase())))?.name;
  if (!methodName) throw new Error('夹具缺少能与路径查询区分的函数名');
  const methodExpected = [...methods.values()].filter(row => `${row.path}\n${row.name}`.toLowerCase().includes(methodName.toLowerCase())).length;
  check('capacity.method-name', methodExpected, (await query({type: 'methods', search: methodName})).total, 0);
  const filePath = [...methods.values()][0].path;
  check('capacity.method-path', [...methods.values()].filter(row => row.path.includes(filePath)).length, (await query({type: 'methods', search: filePath})).total);
  const changed = [...methods.values()].filter(row => row.baseline.length > 1 || row.current.length > 1 || !row.baseline.length || !row.current.length || row.baseline[0].nbnc_loc !== row.current[0].nbnc_loc).length;
  const ambiguousShared = [...methods.values()].filter(row => row.baseline.length && row.current.length && (row.baseline.length > 1 || row.current.length > 1)).length;
  check('capacity.default-ambiguity', changed, (await query({type: 'methods', status: 'changes'})).total, changed - ambiguousShared);

  const positions = new Map();
  for (const report of Object.values(reports)) {
    for (const [file, names] of Object.entries(report.detail_metrics.unsafe_functions)) {
      for (const [name, lines] of Object.entries(names)) for (const line of new Set(lines)) {
        positions.set(JSON.stringify([relative(file), name, line]), {path: relative(file), name});
      }
    }
  }
  const unsafeName = [...positions.values()].find(row => !paths.some(p => p.toLowerCase().includes(row.name.toLowerCase())))?.name;
  if (!unsafeName) throw new Error('夹具缺少能与路径查询区分的危险函数名');
  check('capacity.unsafe-name', [...positions.values()].filter(row => `${row.path}\n${row.name}`.toLowerCase().includes(unsafeName.toLowerCase())).length, (await query({type: 'unsafe', search: unsafeName})).total, 0);

  const group = Object.entries(reports.baseline.detail_metrics.code_duplication).find(([, members]) => members.length > 30);
  if (!group) throw new Error('夹具需要至少 31 个片段的重复组');
  const [groupId, members] = group;
  const fileId = paths.indexOf(relative(members[0].file_name));
  const evidence = await send({op: 'evidence', rowId: `f:${fileId}`, opts: {fragPage: {[`baseline:${groupId}`]: 2}}});
  const actualGroup = evidence.fragGroups.find(g => g.side === 'baseline' && g.groupId === groupId);
  check('capacity.fragment-page-key', {page: 2, firstPath: relative(members[30].file_name), start: members[30].start_line}, {page: actualGroup?.page, firstPath: actualGroup?.members[0]?.path, start: actualGroup?.members[0]?.start}, {page: 1, firstPath: relative(members[0].file_name), start: members[0].start_line});
  if (flags.includes('--extended')) {
    const text = (a,b) => a < b ? -1 : a > b ? 1 : 0;
    const fileRows = paths.map(p => {
      const b = reports.baseline.detail_metrics.file_sizes[prefix+p]?.[0] ?? null;
      const c = reports.current.detail_metrics.file_sizes[prefix+p]?.[0] ?? null;
      return {path:p,b,c,delta:(c??0)-(b??0)};
    });
    for (const sort of ['path-desc','current-asc','current-desc','delta-asc','delta-desc']) {
      const [field,direction] = sort.split('-'), sign = direction === 'asc' ? 1 : -1;
      const key = field === 'current' ? 'c' : field;
      const expected = [...fileRows].sort((a,b) => {
        if (field === 'path') return sign*text(a.path,b.path);
        if (a[key] == null || b[key] == null) return a[key] == null && b[key] == null ? text(a.path,b.path) : a[key] == null ? 1 : -1;
        return sign*(a[key]-b[key]) || text(a.path,b.path);
      });
      for (const page of [1,51,Math.ceil(paths.length/7)]) {
        const actual = await query({sort,page,pageSize:7});
        check(`extended.files.${sort}.${page}`, expected.slice((page-1)*7,page*7).map(r=>r.path), actual.rows.map(r=>r.path));
      }
    }
    const expectedMethods = [...methods.values()].sort((a,b)=>text(a.path,b.path)||text(a.name,b.name)).map(r=>[r.path,r.name]);
    const allMethods = [];
    for(let page=1;page<=Math.ceil(methods.size/200);page++) {
      const result = await query({type:'methods',page,pageSize:200});
      allMethods.push(...result.rows.map(r=>[r.path,r.name]));
    }
    const digest = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    check('extended.methods.all-pages', {total:expectedMethods.length,sha256:digest(expectedMethods)}, {total:allMethods.length,sha256:digest(allMethods)});
    const empty = await query({search:'__cmetrics_absent_7fa94__',page:51});
    check('extended.empty-page', {page:0,pages:0,total:0,rows:[]}, {page:empty.page,pages:empty.pages,total:empty.total,rows:empty.rows});
    const clamped = await query({page:paths.length+10});
    check('extended.clamped-page', {page:paths.length,paths:[paths.at(-1)]}, {page:clamped.page,paths:clamped.rows.map(r=>r.path)});
  }
  const verify = await send({op: 'verify'});
  check('capacity.existing-self-check', {checks: 26, failed: 0}, {checks: verify.length, failed: verify.filter(r => !r.pass).length});
  const counts = Object.fromEntries(['pass', 'known-failure', 'unexpected-pass', 'fail'].map(status => [status, checks.filter(c => c.status === status).length]));
  console.log(JSON.stringify({
    protocol: flags.includes('--extended') ? 'capacity-query-2' : 'capacity-baseline-1', runtime: process.version,
    workerSha256: crypto.createHash('sha256').update(source).digest('hex'),
    coverage: '已知查询缺口与既有26项自检；不代表33项汇总或浏览器验收', counts, checks,
  }, null, 2));
  process.exitCode = counts.fail || counts['unexpected-pass'] ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
