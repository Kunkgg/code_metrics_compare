/* 已批准业务预期核验紧凑 HTML 中的真实 Worker；逐页收集完整结果。 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadWorker}=require('./worker-harness.cjs');
(async()=>{
  const [reportRoot,...directories]=process.argv.slice(2);
  if(!reportRoot||!directories.length)throw new Error('用法：node check-worker-business.cjs 产物根目录 夹具目录 [...]');
  const results=[],measurements=[];
  for(const directory of directories){
    const fixture=path.basename(directory),expected=JSON.parse(fs.readFileSync(path.join(directory,'expected.json'),'utf8'));
    const html=fs.readFileSync(path.join(reportRoot,fixture,'cmetrics-prototype.html'),'utf8');
    const {send,source}=await loadWorker(html,'report-worker');
    const state={view:'workspace',scenario:'normal',type:'code',metric:'code_size',directory:'',query:'',exactFile:null,searchScope:'directory',status:'all',sort:'path:asc',numberFilter:null,page:1,pageSize:2,selected:null,directoryPage:1,chartPage:1,overviewChanges:['growth','decrease']};
    const check=(name,wanted,actual)=>results.push({fixture,name,pass:JSON.stringify(wanted)===JSON.stringify(actual),expected:wanted,actual});
    const initial=await send({op:'snapshot',state});
    for(const side of ['baseline','current']){
      const input=JSON.parse(fs.readFileSync(path.join(directory,side+'.json'),'utf8'));
      for(const [key,value] of Object.entries(input.summary_metrics))check(side+'.serialized.'+key,value,initial.model.sides[side].summary[key]);
      check(side+'.serialized.maxima',input.detail_metrics.method_metrics.at(-1),initial.model.sides[side].report.detail_metrics.method_metrics.at(-1));
    }
    for(const [key,wanted] of Object.entries(expected.summary_comparison||{})){
      const value=side=>key==='maximum_nbnc_loc'?initial.model.sides[side].report.detail_metrics.method_metrics.at(-1)[key]:initial.model.sides[side].summary[key];
      const b=value('baseline'),c=value('current');check('summary.'+key,wanted,{b,c,delta:b==null||c==null?null:Math.round((c-b)*1e6)/1e6});
    }
    for(const query of expected.queries){
      const patch={...state,...query.state,pageSize:2},rows=[];
      let first;
      for(let page=1;page<=Math.max(1,first?.query.pages||1);page++){
        const snapshot=await send({op:'snapshot',state:{...patch,page}});first??=snapshot;
        if(snapshot.query.rows.length>patch.pageSize)throw new Error('响应超出当前页');
        rows.push(...snapshot.query.rows);
      }
      check(query.name,query.rows,rows.map(row=>query.fields.map(field=>row[field]??null)));
      check(query.name+'.total',query.rows.length,first.query.total);
      if(query.threshold_warning)check(query.name+'.threshold-warning',true,rows.every(row=>row.thresholdChanged&&row.warning?.includes(query.threshold_warning)));
      const samples=[];
      for(let i=0;i<20;i++){
        const start=performance.now();await send({op:'snapshot',state:patch});samples.push(performance.now()-start);
      }
      measurements.push({fixture,task:query.name,samplesMs:samples,p95Ms:[...samples].sort((a,b)=>a-b)[18],measurement:'Node VM 消息往返，不包含浏览器 DOM 或两帧',workerSha256:crypto.createHash('sha256').update(source).digest('hex')});
    }
  }
  const failed=results.filter(item=>!item.pass);
  console.log(JSON.stringify({checks:results.length,failed:failed.length,failures:failed,measurements},null,2));process.exitCode=failed.length?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
