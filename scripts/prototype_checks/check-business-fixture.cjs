/* 固定夹具驱动现有 UI 的业务查询；不执行 Schema、生成器或输入公式校验。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const includeResults = process.argv.includes('--all-results');
const directories = process.argv.slice(2).filter(value => value !== '--all-results');
if (!directories.length) throw new Error('用法：node check-business-fixture.cjs 夹具目录 [...]');
const original = fs.readFileSync(path.join(__dirname, '../../prototypes/ui/prototype.js'), 'utf8');
const marker = '  try {\n    DATA=JSON.parse';
assert(original.includes(marker), 'UI 初始化入口已变更，请更新业务夹具入口');
// 执行实际业务函数，跳过 DOM 渲染和事件注册的副作用。
const source = original.slice(0, original.lastIndexOf(marker)) + `
  globalThis.fixtureApi = {
    setup(data) { DATA=data; state={scenario:'normal'}; model=buildModel(); },
    query(patch) {
      state={scenario:'normal',type:'code',directory:'',exactFile:null,searchScope:'directory',query:'',status:'all',sort:'path:asc',numberFilter:null,page:1,pageSize:200,...patch};
      return queriedRows();
    },
    summary(key) {
      const value=side=>key==='maximum_nbnc_loc'?model.sides[side].report.detail_metrics.method_metrics.at(-1)[key]:model.sides[side].summary[key];
      const b=value('baseline'),c=value('current');return {b,c,delta:knownDelta(b,c)};
    },
    thresholdInfo,
  };
})();`;
const results = [];
for (const directory of directories) {
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name + '.json'), 'utf8'));
  const expected = read('expected');
  const input = {baseline: read('baseline'), current: read('current'), meta: {commonRoot: read('manifest').root, storyPaths: {}, metricNames: {}}};
  const context = {structuredClone, window: {addEventListener() {}}, document: {addEventListener() {}}};
  vm.runInNewContext(source, context);
  const api = context.fixtureApi;
  api.setup(input);
  const check = (name, wanted, actual) => {
    // 消除 VM realm 的原型差异；值与缺失字段仍严格区分。
    actual = JSON.parse(JSON.stringify(actual));
    const pass = JSON.stringify(wanted) === JSON.stringify(actual);
    results.push({fixture: path.basename(directory), name, pass, ...(pass ? {} : {expected: wanted, actual})});
  };
  for (const [metric, wanted] of Object.entries(expected.summary_comparison || {})) {
    // 比较已序列化汇总的实际观测差，不计算净影响，也不替实现再次舍入。
    check('summary.' + metric, wanted, api.summary(metric));
  }
  for (const query of expected.queries) {
    const initial = api.query(query.state);
    // 参考 UI 返回完整匹配结果；Worker 的分页验收另行接入。
    const actual = initial.rows.map(row => query.fields.map(field => row[field]));
    check(query.name, query.rows, actual);
    check(query.name + '.total', query.rows.length, initial.total);
    if (query.threshold_warning) {
      const info = api.thresholdInfo(query.state.type);
      check(query.name + '.threshold-warning', true, info.thresholdChanged && info.issue.includes(query.threshold_warning));
    }
  }
}
const failed = results.filter(result => !result.pass);
console.log(JSON.stringify({checks: results.length, failed: failed.length, fixtures: directories.map(p => path.basename(p)), failures: failed, ...(includeResults ? {results} : {})}, null, 2));
process.exitCode = failed.length ? 1 : 0;
