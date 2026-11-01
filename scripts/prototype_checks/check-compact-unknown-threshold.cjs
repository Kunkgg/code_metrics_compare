/* 未知阈值的真实输入回归：原始 JSON → build → HTML 内真实 Worker。 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {loadWorker}=require('./worker-harness.cjs');
(async()=>{
  const output=path.resolve(process.argv[2]||'output/unified-prototype/next-unknown-threshold');fs.mkdirSync(output,{recursive:true});
  const types={hugeHeader:'huge_headerfile',hugeSource:'huge_non_headerfile',hugeMethod:'huge_method',hugeCC:'huge_cyclomatic_complexity',folders:'huge_folder'};
  const results=[];let checks=0;
  const eq=(actual,expected,message)=>{assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
  for(const [type,key] of Object.entries(types))for(const mode of ['baseline','current','both']){
    const destination=path.join(output,type+'-'+mode);fs.mkdirSync(destination,{recursive:true});const inputs={};
    for(const side of ['baseline','current']){
      const report=JSON.parse(fs.readFileSync(`tests/fixtures/golden/threshold-change/${side}.json`,'utf8'));
      if(mode===side||mode==='both')report.summary_metrics.huge_threshold[key]=null;
      inputs[side]=JSON.stringify(report);fs.writeFileSync(path.join(destination,side+'.json'),inputs[side]);
    }
    fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({root:'/golden/project',config:{seed:1},unionFiles:6}));
    let build;
    try{build=execFileSync('uv',['run','python','-m','prototypes.ui.prototype','--input-dir',destination,'--output-dir',destination],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
    catch(error){fs.writeFileSync(path.join(destination,'build-failure.txt'),String(error.stderr||error));throw new Error(type+'/'+mode+' 真实 JSON 构建失败：'+String(error.stderr||error));}
    fs.writeFileSync(path.join(destination,'build.log'),build);
    const html=fs.readFileSync(path.join(destination,'cmetrics-prototype.html'),'utf8');
    const meta=JSON.parse(zlib.gunzipSync(Buffer.from(html.match(/data-block-kind="meta">([^<]+)/)[1],'base64')));
    for(const side of ['baseline','current'])eq(meta.summaries[side].huge_threshold[key],JSON.parse(inputs[side]).summary_metrics.huge_threshold[key],'原始未知阈值不得补零');
    eq([meta.thresholdTransitions[type].entered,meta.thresholdTransitions[type].exited,meta.thresholdTransitions[type].limited],[0,0,true],type+' 未知阈值不产生确定进出');
    eq(meta.thresholdTransitions[type].thresholdChanged,false,'未知阈值不声称已知阈值变化');
    assert(meta.thresholdTransitions[type].warning.includes('阈值未知'));checks++;
    for(const metric of [key+'_total',key+'_ratio']){assert(meta.integrity.summaryIssues[metric]?.some(reason=>reason.includes('阈值未知')),metric+' 提供阈值未知原因');checks++;}
    const {send,source}=await loadWorker(html,'report-worker');
    const state={view:'workspace',scenario:'normal',type,metric:key+'_ratio',directory:'',query:'',exactFile:null,searchScope:'all',status:'all',sort:'path:asc',numberFilter:null,page:1,pageSize:50,selected:null,directoryPage:1,chartPage:1,overviewChanges:['growth','decrease']};
    const snapshot=await send({op:'snapshot',state});
    eq([snapshot.transitions[type].entered,snapshot.transitions[type].exited,snapshot.transitions[type].limited],[0,0,true],'Worker 传递进出限制');
    for(const row of snapshot.query.rows){eq(row.transitionKnown,false,'未知阈值行不能确定进出');assert(!row.flags.includes('entered')&&!row.flags.includes('exited'));checks++;}
    eq(snapshot.impact.effects,null,'未知阈值净影响不可得');
    eq(snapshot.impact.observedDelta,null,'未知阈值比例观测差值不可得');
    assert(snapshot.impact.issues.some(reason=>reason.includes('阈值未知')));checks++;
    for(const status of ['entered','exited'])eq((await send({op:'snapshot',state:{...state,status}})).query.total,0,'未知阈值进出筛选为空');
    // 没有该类型对象时，阈值本身未知仍须标受限；不能依赖 excluded 集合非空。
    const empty=String.raw`import copy,json
from pathlib import Path
from prototypes.performance.prototype_capacity import SideData,compact_threshold_transitions,compact_integrity,build_dirs
p=Path(__import__('sys').argv[1]);key=__import__('sys').argv[2];kind=__import__('sys').argv[3]
r=json.loads((p/'current.json').read_text());r['summary_metrics']['huge_threshold'][key]=None
d=r['detail_metrics'];d['file_sizes']={};d['method_metrics']=[{}];d['huge_folders']={};d['code_duplication']={};d['file_duplication']={};d['unsafe_functions']={};d['redundant_code']={}
a=SideData(r,'/golden/project',{},{});t,_=compact_threshold_transitions(a,a);assert t[kind]['limited'] and t[kind]['entered']==t[kind]['exited']==0
integrity=compact_integrity(a,a,build_dirs([],a,a,'/golden/project'),'/golden/project');assert any('阈值未知' in reason for reason in integrity['summaryIssues'][key+'_ratio'])`;
    execFileSync('uv',['run','python','-c',empty,destination,key,type],{stdio:'pipe'});checks++;
    const evidence={type,key,mode,integrity:meta.integrity,transition:meta.thresholdTransitions[type],snapshot,inputSha256:Object.fromEntries(Object.entries(inputs).map(([side,value])=>[side,crypto.createHash('sha256').update(value).digest('hex')])),workerSha256:crypto.createHash('sha256').update(source).digest('hex')};
    fs.writeFileSync(path.join(destination,'evidence.json'),JSON.stringify(evidence,null,2));results.push({type,mode,passed:true,evidence:path.join(destination,'evidence.json')});
  }
  const evidence={checks,failed:0,results,scope:'Node VM 中执行产物内真实 Worker，不替代浏览器验证'};fs.writeFileSync(path.join(output,'unknown-threshold-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
