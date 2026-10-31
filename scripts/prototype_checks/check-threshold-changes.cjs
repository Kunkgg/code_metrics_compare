/* 阈值变化定点检查：源码 VM + Python 转换；不依赖大型数据或浏览器。 */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root='/repo';
const keys={hugeHeader:'huge_headerfile',hugeSource:'huge_non_headerfile',hugeMethod:'huge_method',hugeCC:'huge_cyclomatic_complexity',folders:'huge_folder'};
function dataFor(bLimit,cLimit){
  const side=limit=>({summary_metrics:{huge_threshold:Object.fromEntries(Object.values(keys).map(k=>[k,limit])),files_total:2,folders_total:1,methods_total:1,huge_headerfile_total:Number(3>limit),huge_headerfile_ratio:Number(3>limit)*50},detail_metrics:{file_sizes:{'/repo/d/a.h':[3,3,0],'/repo/d/b.c':[3,3,0]},method_metrics:[{file_name:'/repo/d/b.c',method_name:'work',start_line:1,end_line:3,nbnc_loc:3,cyclomatic_complexity:3},{}],huge_folders:3>limit?{'/repo/d':3}:{},code_duplication:{},file_duplication:{},unsafe_functions:{},redundant_code:{}}});
  // 三个直接成员用于目录边界；值为3，两侧代码和成员完全相同。
  const data={baseline:side(bLimit),current:side(cLimit),meta:{commonRoot:root,storyPaths:{},metricNames:{}}};
  for(const report of [data.baseline,data.current])report.detail_metrics.file_sizes['/repo/d/c.c']=[3,3,0];
  return data;
}
const original=fs.readFileSync('prototypes/ui/prototype.js','utf8');
const source=original.slice(0,original.lastIndexOf('  try {\n    DATA=JSON.parse'))+`globalThis.check={setup(data,type){DATA=data;state={scenario:'normal',type,overviewChanges:['growth','decrease']};model=buildModel();},rowsFor,transition,thresholdCondition,rowStatus,matchesStatus,overviewMetric,metricRows,metricCard,fractionChange};})();`;
const context={window:{addEventListener(){}},document:{addEventListener(){}},structuredClone};
vm.runInNewContext(source,context);
const old=context.check;
const workerSource=fs.readFileSync('prototypes/ui/ui_queries.js','utf8')+'\nglobalThis.check={uiSetContext,uiSource,uiMatchesStatus};';
let checks=0;
for(const [bLimit,cLimit,status] of [[3,2,'entered'],[2,3,'exited']]){
  const data=dataFor(bLimit,cLimit);
  for(const type of Object.keys(keys)){
    old.setup(data,type);
    const row=old.rowsFor(type)[0];
    assert(row&&row.delta===0&&row.thresholdChanged,type+' 旧 UI 保留零差值');
    assert(row.flags.includes(status)&&!row.flags.includes('incomparable'),type+' 旧 UI 按侧阈值判进出');
    assert(old.matchesStatus(row,'changes')&&!old.matchesStatus(row,'unchanged'));
    assert(old.rowStatus(row).includes(status==='entered'?'新增超限':'退出超限'));
    const note=old.thresholdCondition(type);
    assert(note.includes(`基线 &gt; <b>${bLimit}</b>`)&&note.includes(`当前 &gt; <b>${cLimit}</b>`)&&note.includes('不证明代码恶化或改善'));
    assert.equal(old.transition(type)[status],type==='hugeSource'?2:1);
    checks+=6;
  }
  old.setup(data,'hugeHeader');
  const overview=old.overviewMetric(['huge_headerfile_total','hugeHeader']);
  assert.equal(overview.d,status==='entered'?1:-1);
  assert(!overview.issue&&overview.warning&&old.metricCard(overview).includes('阈值变化'));
  const fraction=old.fractionChange('d','huge_headerfile_ratio');
  assert.equal(fraction.effects,null,'阈值变化仍限制净影响分解');
  assert.notEqual(fraction.observedDelta,null,'观测差值可得');
  assert.equal(fraction.transitions.limited,false);
  checks+=5;

  const S={meta:{summaries:{baseline:data.baseline.summary_metrics,current:data.current.summary_metrics}},F:3,paths:['d/a.h','d/b.c','d/c.c'],names:['work'],files:{bEx:[1,1,1],cEx:[1,1,1],bN:[3,3,3],cN:[3,3,3]},dirs:[{p:'d',kB:bLimit<3?3:null,kC:cLimit<3?3:null,cf:[0,1,2],cd:[],bF:3,cF:3}],dirByPath:new Map([['d',0]]),mB:{count:1,views:{na:[0],ln:[3],cc:[3]}},mC:{count:1,views:{na:[0],ln:[3],cc:[3]}},rangeB:[0,0,1,1],rangeC:[0,0,1,1]};
  const worker={S,structuredClone};vm.runInNewContext(workerSource,worker);worker.check.uiSetContext('normal');
  for(const type of Object.keys(keys)){
    const src=worker.check.uiSource(type),index=type==='hugeSource'?1:0,row=src.row(index);
    assert(src.included(index)&&row.thresholdChanged&&row.warning.includes('不证明代码恶化或改善'));
    assert(row.flags.includes(status)&&!row.flags.includes('incomparable'));
    assert(worker.check.uiMatchesStatus(row,'changes')&&!worker.check.uiMatchesStatus(row,'unchanged'));
    if(type!=='folders')assert.equal(row.delta,0);else assert.equal(row.delta,null,'未申报侧原值仍未知');
    checks+=4;
  }
  // 非阈值未知和歧义仍限制清单进出。
  S.files.cValid=[0,1,1];
  let unknown=worker.check.uiSource('hugeHeader').row(0);
  assert(unknown.flags.includes('unknown')&&!unknown.transitionKnown);
  data.baseline.detail_metrics.file_sizes['/repo/d/a.h'][0]=4;old.setup(data,'hugeHeader');data.current.detail_metrics.file_sizes['/repo/d/a.h'][0]=null;old.setup(data,'hugeHeader');
  unknown=old.rowsFor('hugeHeader')[0];assert(unknown.flags.includes('unknown')&&!old.matchesStatus(unknown,'entered')&&!old.matchesStatus(unknown,'exited'));
  checks+=2;
  S.mC={count:2,views:{na:[0,0],ln:[3,3],cc:[3,3]}};S.rangeC=[0,0,2,2];
  const ambiguousContext={S,structuredClone};vm.runInNewContext(workerSource,ambiguousContext);ambiguousContext.check.uiSetContext('normal');
  const ambiguous=ambiguousContext.check.uiSource('hugeMethod').row(0);
  assert(ambiguous.ambiguous&&!ambiguous.transitionKnown&&ambiguous.delta===null);
  assert(!ambiguous.flags.includes('entered')&&!ambiguous.flags.includes('exited'));
  S.dirs[0].kC=4;
  const mismatch=worker.check.uiSource('folders').row(0);
  assert(mismatch.flags.includes('incomparable')&&!mismatch.transitionKnown,'成员覆盖不符仍限制进出');
  checks+=3;
}
// 普通代码行按数值判变化：扫描集合进出不改变 0→0 的无变化分类。
for(const entering of [true,false]){
  const data=dataFor(3,3),path='/repo/d/empty.c';
  data[entering?'current':'baseline'].detail_metrics.file_sizes[path]=[0,0,0];
  old.setup(data,'code');
  const row=old.rowsFor('code').find(row=>row.path==='d/empty.c');
  assert.equal(row.delta,0);
  assert.equal(row.changed,false,'普通 0→0 文件不进入 changes');
  assert(old.matchesStatus(row,'unchanged')&&!old.matchesStatus(row,'changes'));
  assert(old.rowStatus(row).includes('无变化'),'普通 0→0 文件标为无变化');
  const S={meta:{summaries:{baseline:data.baseline.summary_metrics,current:data.current.summary_metrics}},F:1,paths:['d/empty.c'],files:{bEx:[Number(!entering)],cEx:[Number(entering)],bN:[0],cN:[0]}};
  const worker={S,structuredClone};vm.runInNewContext(workerSource,worker);worker.check.uiSetContext('normal');
  const workerRow=worker.check.uiSource('code').row(0);
  assert.equal(workerRow.delta,0);
  assert.equal(workerRow.changed,false,'Worker 普通 0→0 文件不进入 changes');
  assert(worker.check.uiMatchesStatus(workerRow,'unchanged')&&!worker.check.uiMatchesStatus(workerRow,'changes'));
  checks+=7;
}
// Python 两种转换及两个静态概览走真实函数，输入全部在内存构造。
const python=String.raw`
import copy
from types import SimpleNamespace
from prototypes.ui.prototype import threshold_transitions, static_overview, THRESHOLD_KEYS
from prototypes.performance.prototype_capacity import compact_threshold_transitions, static_overview as capacity_static
for b, c, status in [(3, 2, 'entered'), (2, 3, 'exited')]:
    def report(limit):
        return {'summary_metrics': {'huge_threshold': dict.fromkeys(THRESHOLD_KEYS.values(), limit), 'huge_headerfile_total': int(3 > limit)}, 'detail_metrics': {'file_sizes': {'/repo/d/a.h': [3,3,0], '/repo/d/b.c': [3,3,0]}, 'method_metrics': [{'file_name':'/repo/d/b.c','method_name':'work','nbnc_loc':3,'cyclomatic_complexity':3}, {}], 'huge_folders': {'/repo/d':3} if 3 > limit else {}}}
    baseline, current = report(b), report(c)
    expected = threshold_transitions(baseline, current)
    def compact(r):
        return SimpleNamespace(summary=r['summary_metrics'], files=r['detail_metrics']['file_sizes'], methods=[(0,0,1,3,3,3)], huge_folders=r['detail_metrics']['huge_folders'])
    actual, _ = compact_threshold_transitions(compact(baseline), compact(current))
    assert actual == expected
    for value in expected.values():
        assert value[status] == 1 and not value['limited'] and value['thresholdChanged']
        assert f'基线 > {b}' in value['warning'] and f'当前 > {c}' in value['warning']
    summaries = {side: r['summary_metrics'] for side, r in [('baseline',baseline),('current',current)]}
    meta = {'mainMetrics': [('huge_headerfile_total','个','超大指标')], 'metricNames':{}, 'summaries':summaries, 'thresholdTransitions':expected}
    assert '阈值变化' in capacity_static(meta) and '不证明代码恶化或改善' in capacity_static(meta)
    # UI 静态概览只临时缩小展示指标；不触碰任何输入文件。
    import prototypes.ui.prototype as ui
    ui.MAIN_METRICS = [('huge_headerfile_total','个')]
    meta.update(metricNames={'huge_headerfile_total':'超大头文件'}, identities={'baseline':{'version':'b'},'current':{'version':'c'}},limitations=[])
    rendered=static_overview({'meta':meta,'baseline':baseline,'current':current})
    assert '阈值变化' in rendered and '不证明代码恶化或改善' in rendered
print('Python 转换和静态概览通过')
`;
process.stdout.write(execFileSync('uv',['run','python','-c',python],{encoding:'utf8'}));
console.log(JSON.stringify({checks,result:'passed',coverage:'五类超限的阈值进入/退出、双阈值提示、零差值、未知/歧义/成员覆盖限制、净影响限制及 Python 转换/静态概览'},null,2));
