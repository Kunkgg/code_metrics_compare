const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(process.argv[2] || 'output/prototype/cmetrics-prototype.html','utf8');
const data=JSON.parse(html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)[1]);
const source=fs.readFileSync('prototypes/ui/prototype.js','utf8').replace(/\}\)\(\);\s*$/, 'globalThis.check = {overviewMetric,transition,metricCard,rowsFor,matchesStatus,setType: type=>state.type=type};})();');
const results=[];
function load(change){
  const input=structuredClone(data);change(input);
  const nodes={'#report-data':{textContent:JSON.stringify(input)},'#app':{},'#init-status':{}};
  const context={structuredClone,URLSearchParams,PROTOTYPE_MODE:false,location:{search:''},document:{querySelector:selector=>nodes[selector],addEventListener(){},documentElement:{classList:{add(){},remove(){}}}},window:{addEventListener(){}},console:{info(){},error(error){throw error;}}};
  vm.runInNewContext(source,context);
  return context.check;
}
function assert(condition,message){if(!condition)throw new Error(message);results.push(message);}
let app=load(input=>{[input.baseline,input.current]=[input.current,input.baseline];});
for(const [key,type] of [['code_size','code'],['lines_per_file','code'],['lines_per_method','methodLines'],['code_duplication_ratio','duplication'],['file_duplication_ratio','dupfiles'],['non_hfile_code_duplication_ratio','sourceDuplication'],['non_hfile_duplication_ratio','sourceDupfiles']]){
  const item=app.overviewMetric([key,type]);assert(item.d<0&&item.directions.join()==='decrease',`${key} 减少方向正确`);
}
app=load(input=>{input.current=structuredClone(input.baseline);});
for(const [key,type] of [['huge_headerfile_ratio','hugeHeader'],['huge_non_headerfile_total','hugeSource'],['huge_method_total','hugeMethod'],['huge_cyclomatic_complexity_ratio','hugeCC'],['huge_folder_ratio','folders']]){
  const item=app.overviewMetric([key,type]);assert(item.directions.join()==='unchanged'&&item.t.entered===0&&item.t.exited===0,`${key} 真正无进出时归为无变化`);
}
// 两位序列化可能让不同原始均值相等，不能假设交换扫描后每项均值必然减少。
app=load(input=>{input.baseline.summary_metrics.cyclomatic_complexity_per_method=6.39;input.current.summary_metrics.cyclomatic_complexity_per_method=6.39;});
const roundedMean=app.overviewMetric(['cyclomatic_complexity_per_method','cc']);
assert(roundedMean.d===0&&roundedMean.directions.join()==='unchanged','两侧序列化均值相等时观测差为零');
for(const sign of [-1,1]){
  app=load(input=>{input.current.summary_metrics.lines_per_file=input.baseline.summary_metrics.lines_per_file+sign*1e-9;});
  assert(app.overviewMetric(['lines_per_file','code']).directions.join()===(sign>0?'growth':'decrease'),'小于显示与六位精度的非零差值保持真实方向');
}
app=load(input=>{input.current.summary_metrics.files_total=0;});
for(const [key,type] of [['lines_per_file','code'],['file_duplication_ratio','dupfiles'],['huge_headerfile_ratio','hugeHeader']]){
  const item=app.overviewMetric([key,type]);assert(item.d===null&&item.directions.length===0&&item.issue.includes('分母为零'),`${key} 零分母单独显示异常`);
}
app=load(input=>{input.current.summary_metrics.code_duplication_ratio=null;});
let item=app.overviewMetric(['code_duplication_ratio','duplication']);assert(item.d===null&&item.directions.length===0&&item.issue==='数据未知','未知汇总不能归为零');
app=load(input=>{const path=Object.keys(input.baseline.detail_metrics.file_sizes).find(p=>p.endsWith('.h')&&input.baseline.detail_metrics.file_sizes[p][0]>500);input.current.detail_metrics.file_sizes[path][0]=null;});
item=app.overviewMetric(['huge_headerfile_total','hugeHeader']);assert(item.t.limited&&item.d===null&&item.directions.length===0,'未知对象不参与确定的超限进出');
app=load(input=>{const m=input.current.detail_metrics.method_metrics.find(m=>m.nbnc_loc>input.current.summary_metrics.huge_threshold.huge_method);input.current.detail_metrics.method_metrics.splice(0,0,structuredClone(m));});
item=app.overviewMetric(['huge_method_ratio','hugeMethod']);assert(item.t.limited&&item.issue&&item.directions.length===0,'同名超限函数无法配对时不归为无变化');
for(const sign of [-1,1]){
  app=load(input=>{input.baseline.summary_metrics.lines_per_file=sign>0?1:1.005;input.current.summary_metrics.lines_per_file=sign>0?1.005:1;});
  const card=app.metricCard(app.overviewMetric(['lines_per_file','code']));
  assert(card.includes(sign>0?'+0.01<small>':'-0.01<small>'),'半分边界显示与静态 Decimal 舍入一致');
}
app=load(input=>{const path=Object.keys(input.current.detail_metrics.file_sizes).find(p=>p.endsWith('.h')&&input.current.detail_metrics.file_sizes[p][0]>500);input.baseline.detail_metrics.file_sizes[path][0]=null;});
app.setType('hugeHeader');
const unknown=app.rowsFor('hugeHeader').find(row=>row.flags.includes('unknown'));
assert(unknown&&!app.matchesStatus(unknown,'entered')&&!app.matchesStatus(unknown,'exited')&&app.matchesStatus(unknown,'exceptions'),'未知超限对象在概览与分析进出筛选口径一致');
console.log(JSON.stringify({checks:results.length,result:'passed'},null,2));
