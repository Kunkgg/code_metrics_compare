/* 路径／名称字典回归：真实 JSON 构建、独立解码、真实 Worker 及旧换行块兼容。 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {loadWorker}=require('./worker-harness.cjs');
(async()=>{
  const output=path.resolve(process.argv[2]||'output/unified-prototype/next-dictionary');fs.mkdirSync(output,{recursive:true});
  const root='/golden/project';
  const paths=['src/line\nbreak.c','src/quote"single\'.c','src/back\\slash.c','src/<script>alert("x")</script>.c','src/@@DATA@@-@@WORKER@@.c','src/[json-looking].c'];
  const names=['line\nmethod','quote"single\'','back\\slash','<script>alert("x")</script>','@@DATA@@-@@WORKER@@','[json-looking]'];
  const inputHashes={};
  for(const side of ['baseline','current']){
    const report=JSON.parse(fs.readFileSync(`tests/fixtures/golden/method-lines/${side}.json`,'utf8')),d=report.detail_metrics,current=side==='current';
    d.file_sizes=Object.fromEntries(paths.map((p,i)=>[root+'/'+p,[100+i+(current?10:0),200+i,i]]));
    d.method_metrics=paths.map((p,i)=>({file_name:root+'/'+p,method_name:names[i],start_line:1,end_line:20,nbnc_loc:i+1+(current?10:0),cyclomatic_complexity:i+2}));
    d.method_metrics.push({maximum_nbnc_loc:current?16:6,maximum_cyclomatic_complexity:7});
    d.code_duplication={};d.file_duplication={};d.unsafe_functions={};d.redundant_code={};d.huge_folders={};
    const content=JSON.stringify(report);fs.writeFileSync(path.join(output,side+'.json'),content);inputHashes[side]=crypto.createHash('sha256').update(content).digest('hex');
  }
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({root,config:{seed:1},unionFiles:paths.length}));
  const build=execFileSync('uv',['run','python','-m','prototypes.ui.prototype','--input-dir',output,'--output-dir',output],{encoding:'utf8'});fs.writeFileSync(path.join(output,'build.log'),build);
  const html=fs.readFileSync(path.join(output,'cmetrics-prototype.html'),'utf8');
  const decode=(document,kind)=>zlib.gunzipSync(Buffer.from(document.match(new RegExp(`data-block-kind="${kind}">([^<]+)`))[1],'base64')).toString();
  const meta=JSON.parse(decode(html,'meta'));let checks=0;
  const eq=(actual,expected,message)=>{assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
  assert.equal(meta.dictionaryEncoding,'json','必须显式声明字典编码');checks++;
  eq(JSON.parse(decode(html,'paths')),[...paths].sort(),'独立解码路径完整保留');
  eq(JSON.parse(decode(html,'names')),[...names].sort(),'独立解码函数名完整保留');
  const state={view:'workspace',scenario:'normal',type:'code',metric:'code_size',directory:'',query:'',exactFile:null,searchScope:'all',status:'all',sort:'path:asc',numberFilter:null,page:1,pageSize:50,selected:null,directoryPage:1,chartPage:1,overviewChanges:['growth','decrease']};
  const {send,source}=await loadWorker(html,'report-worker'),snapshots={};
  const files=await send({op:'snapshot',state});snapshots.files=files;
  eq(files.query.total,paths.length,'特殊字符不产生额外路径');
  for(let i=0;i<paths.length;i++){
    const row=files.query.rows.find(r=>r.path===paths[i]);assert(row,'原始路径完整保留');checks++;
    eq([row.b,row.c,row.delta],[100+i,110+i,10],'文件 ID 与数值列不失配');
    const exact=await send({op:'snapshot',state:{...state,exactFile:paths[i]}});eq(exact.query.rows.map(r=>r.path),[paths[i]],'精确文件定位完整保留');
  }
  const methods=await send({op:'snapshot',state:{...state,type:'methodLines',metric:'lines_per_method'}});snapshots.methods=methods;
  eq(methods.query.total,names.length,'特殊字符不产生额外名称');
  for(let i=0;i<names.length;i++){
    const row=methods.query.rows.find(r=>r.path===paths[i]&&r.name===names[i]);assert(row,'路径与函数名完整配对');checks++;
    eq([row.b,row.c,row.delta],[i+1,i+11,10],'函数 ID 与数值列不失配');
    eq([row.after[0].file_name,row.after[0].method_name],[root+'/'+paths[i],names[i]],'原始函数证据完整保留');
  }
  // 用相同数值列构造旧格式块；首字符为 [ 的旧文本必须按标记缺失走换行分支。
  const replaceBlock=(document,kind,value)=>document.replace(new RegExp(`(data-block-kind="${kind}">)[^<]+`),(_,prefix)=>prefix+zlib.gzipSync(Buffer.from(value)).toString('base64'));
  const oldPaths=JSON.parse(decode(html,'paths')).map((_,i)=>i===0?'[legacy-path].c':`legacy/file-${i}.c`);
  const oldNames=JSON.parse(decode(html,'names')).map((_,i)=>i===0?'[legacy-name]':`legacy-name-${i}`);
  const legacyMeta={...meta};delete legacyMeta.dictionaryEncoding;
  let legacy=replaceBlock(html,'meta',JSON.stringify(legacyMeta));legacy=replaceBlock(legacy,'paths',oldPaths.join('\n'));legacy=replaceBlock(legacy,'names',oldNames.join('\n'));
  fs.writeFileSync(path.join(output,'legacy-dictionary.html'),legacy);
  const oldWorker=await loadWorker(legacy,'report-worker'),legacyFiles=await oldWorker.send({op:'snapshot',state}),legacyMethods=await oldWorker.send({op:'snapshot',state:{...state,type:'methodLines'}});
  eq(legacyFiles.query.rows.map(r=>r.path),oldPaths,'无标记旧路径格式兼容，不按首字符猜测');
  eq(legacyMethods.query.rows.map(r=>r.name).sort(),oldNames.sort(),'无标记旧名称格式兼容');
  const oldArtifact=path.resolve('output/unified-prototype/next-anomalies/golden-preservation/threshold-change/cmetrics-prototype.html');let oldArtifactEvidence=null;
  if(fs.existsSync(oldArtifact)){
    const original=fs.readFileSync(oldArtifact,'utf8'),originalMeta=JSON.parse(decode(original,'meta'));
    assert(!originalMeta.dictionaryEncoding,'所选产物必须是旧编码');checks++;
    // 保留旧产物所有块，仅替换为当前真实 Worker，验证新解码器能读旧输入。
    const upgraded=original.replace(/(<script type="text\/plain" id="report-worker">)[\s\S]*?(<\/script>)/,(_,start,end)=>start+source+end);
    const loaded=await loadWorker(upgraded,'report-worker');const snapshot=await loaded.send({op:'snapshot',state});
    eq(snapshot.query.rows.map(r=>r.path),decode(original,'paths').split('\n'),'实际旧产物路径完整加载');
    oldArtifactEvidence={path:oldArtifact,sha256:crypto.createHash('sha256').update(original).digest('hex'),snapshot};
  }
  const evidence={checks,failed:0,inputHashes,workerSha256:crypto.createHash('sha256').update(source).digest('hex'),paths,names,snapshots,legacy:{paths:oldPaths,names:oldNames,files:legacyFiles,methods:legacyMethods},oldArtifactEvidence,scope:'真实构建及 Node VM Worker；不代表浏览器渲染验收'};
  fs.writeFileSync(path.join(output,'dictionary-evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({checks,failed:0,output,actualOldArtifactLoaded:!!oldArtifactEvidence,workerSha256:evidence.workerSha256},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
