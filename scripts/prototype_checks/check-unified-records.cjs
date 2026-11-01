/* 独立证据夹具、同名函数完整原记录检查及 agent-browser 实跑入口；不改 Golden。 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {loadWorker}=require('./worker-harness.cjs');
(async()=>{
  const output=path.resolve(process.argv[2]||'output/unified-prototype/next-evidence-complete');
  fs.mkdirSync(output,{recursive:true});
  const derived=execFileSync(process.execPath,['scripts/prototype_checks/check-unified-evidence.cjs',output],{encoding:'utf8'});
  fs.writeFileSync(path.join(output,'derived-checks.json'),derived);
  const root='/golden/project',header='src/zz-header.h',anchor='src/anchor.c';
  for(const side of ['baseline','current']){
    const file=path.join(output,side+'.json'),report=JSON.parse(fs.readFileSync(file)),d=report.detail_metrics,s=report.summary_metrics;
    d.file_sizes[root+'/'+header]=[100,120,10];
    for(const group of Object.values(d.code_duplication))group.push({file_name:root+'/'+header,start_line:9000,code_duplication:1});
    for(const group of Object.values(d.file_duplication))group.push(root+'/'+header);
    const count=side==='baseline'?45:47;
    d.method_metrics=Array.from({length:count},(_,i)=>({file_name:root+'/'+anchor,method_name:'same_name',start_line:10+i*10,end_line:15+i*10,nbnc_loc:6+i,cyclomatic_complexity:2+i}));
    d.method_metrics.push({maximum_cyclomatic_complexity:count+1,maximum_nbnc_loc:count+5});
    Object.assign(s,{methods_total:count,method_lines:count*(count+11)/2,cyclomatic_complexity_total:count*(count+3)/2,files_total:48,code_size:4800,raw_lines:5760});
    fs.writeFileSync(file,JSON.stringify(report));
  }
  execFileSync('uv',['run','python','-m','prototypes.ui.prototype','--input-dir',output,'--output-dir',output],{stdio:'pipe'});
  const {send}=await loadWorker(fs.readFileSync(path.join(output,'cmetrics-prototype.html'),'utf8'),'report-worker');
  const state={view:'workspace',scenario:'normal',type:'cc',metric:'cyclomatic_complexity_per_method',directory:'',query:'',status:'all',sort:'path:asc',page:1,pageSize:10,selected:null,exactFile:null,searchScope:'all',directoryPage:1,chartPage:1,overviewChanges:['growth','decrease']};
  const results=[];
  for(const type of ['cc','methodLines','hugeCC','hugeMethod'])for(const side of ['baseline','current']){
    const rows=[],raw=[];
    for(let page=1;page<=3;page++){
      const snapshot=await send({op:'snapshot',state:{...state,type,methodPages:{[side]:page}}});
      const row=snapshot.query.rows[0];if(!row)throw new Error(type+' 缺少同名函数');
      raw.push(snapshot);rows.push(...row[side==='baseline'?'before':'after']);
    }
    const expected=JSON.parse(fs.readFileSync(path.join(output,side+'.json'))).detail_metrics.method_metrics.slice(0,-1).map(({file_name,...m})=>({...m,path:anchor,file_name}));
    const canonical=items=>items.map(m=>[m.file_name,m.method_name,m.start_line,m.end_line,m.nbnc_loc,m.cyclomatic_complexity]);
    results.push({type,side,pass:JSON.stringify(canonical(rows))===JSON.stringify(canonical(expected)),expected,actual:rows,snapshots:raw});
  }
  const records={checks:results.length,failed:results.filter(r=>!r.pass).length,results};
  fs.writeFileSync(path.join(output,'records-worker.json'),JSON.stringify(records,null,2));
  const browser=(args,input)=>execFileSync('agent-browser',['--session','evidence-complete',...args,'--json'],{input,encoding:'utf8',maxBuffer:32*1024*1024,timeout:180000});
  fs.writeFileSync(path.join(output,'browser-open.json'),browser(['open','file://'+path.join(output,'cmetrics-prototype.html')]));
  browser(['wait','--fn',"document.documentElement.dataset.queryState === 'ready'"]);
  fs.writeFileSync(path.join(output,'browser-before.json'),browser(['snapshot','-i']));
  const code=fs.readFileSync('scripts/prototype_checks/check-unified-evidence-complete.js','utf8').trim().replace(/;$/,'');
  fs.writeFileSync(path.join(output,'browser-start.json'),browser(['eval','--stdin'],`window.__evidenceComplete=null; (${code}).then(result=>window.__evidenceComplete=result).catch(error=>window.__evidenceComplete={failed:1,error:String(error)}); 'started'`));
  let raw;
  for(let attempt=0;attempt<180;attempt++){
    raw=browser(['eval','--stdin'],'window.__evidenceComplete');
    if(JSON.parse(raw).data?.result)break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  fs.writeFileSync(path.join(output,'evidence-complete-browser.json'),raw);
  const parsed=JSON.parse(raw),result=parsed.data?.result;
  console.log(JSON.stringify({output,records:{checks:records.checks,failed:records.failed},browser:result??parsed},null,2));
  if(records.failed||!result||result.failed||!parsed.success)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
