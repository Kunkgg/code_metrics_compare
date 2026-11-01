/* 独立 raw JSON oracle：Node 中执行 HTML 的真实 Worker，核对完整查询；不启动浏览器。
 * 用法：node --max-old-space-size=6144 scripts/prototype_checks/check-unified-scale-oracle.cjs 输入目录 HTML [独立输出目录] [实测state数组或capacity results.json]
 * 预期只来自 raw JSON；被测侧直接调用 uiQuery 并逐个投影全部 cached IDs。
 * capacity results.json 中已有的 DOM ID/总数/页码另行回放比对，且绑定输入与HTML摘要；未采ID的样本明确保留限制。
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const metrics=[['code_size','code'],['lines_per_file','code'],['lines_per_method','methodLines'],['cyclomatic_complexity_per_method','cc'],['code_duplication_ratio','duplication'],['file_duplication_ratio','dupfiles'],['unsafe_functions_total','unsafe'],['redundant_code_total','redundant'],['non_hfile_code_duplication_ratio','sourceDuplication'],['non_hfile_duplication_ratio','sourceDupfiles'],['huge_headerfile_total','hugeHeader'],['huge_headerfile_ratio','hugeHeader'],['huge_non_headerfile_total','hugeSource'],['huge_non_headerfile_ratio','hugeSource'],['huge_method_total','hugeMethod'],['huge_method_ratio','hugeMethod'],['huge_cyclomatic_complexity_total','hugeCC'],['huge_cyclomatic_complexity_ratio','hugeCC'],['huge_folder_total','folders'],['huge_folder_ratio','folders']];
const thresholds={hugeHeader:'huge_headerfile',hugeSource:'huge_non_headerfile',hugeMethod:'huge_method',hugeCC:'huge_cyclomatic_complexity',folders:'huge_folder'};
const text=(a,b)=>a<b?-1:a>b?1:0,header=p=>/\.(h|hh|hpp|hxx)$/.test(p),sha=()=>crypto.createHash('sha256');
const digestFile=async file=>{const h=sha();for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};
// 固定列和逐行换行构成公开的流式摘要协议；包含身份、原值、状态和同名记录数。
const projection=r=>[r.path,r.name,r.b,r.c,r.delta,r.flags,r.changed,r.ambiguous,r.transitionKnown,r.beforeCount??null,r.afterCount??null,r.line??null,r.thresholdChanged];
function normalNumber(value,label){assert.ok(Number.isFinite(value),`${label}：normal fixture 不允许未知数值`);return value;}
async function main(){
 const [inputArg,htmlArg,outArg,statesArg]=process.argv.slice(2);assert.ok(inputArg&&htmlArg,'用法：node check-unified-scale-oracle.cjs 输入目录 HTML [输出目录] [实测state数组或capacity results.json]');
 let measuredStates=[],measurement=null;
 if(statesArg){const data=JSON.parse(fs.readFileSync(statesArg,'utf8'));if(Array.isArray(data))measuredStates=data;else{assert.ok(data&&Array.isArray(data.runs),'实测输入必须为state数组或capacity results.json');measurement=data;for(const run of data.runs)for(const mode of ['cold','hot'])for(const batch of run[mode]||[])for(const sample of batch){assert.ok(sample.state,'实测样本缺少state');measuredStates.push({state:sample.state,sample:{...sample,run:run.index,mode}});}}}
 const stateOf=entry=>entry.state||entry;
 for(const entry of measuredStates){const state=stateOf(entry);assert.equal(state.scenario,'normal','仅支持normal实测state，不能静默替换场景');assert.ok(metrics.some(([metric,type])=>type===state.type&&(!state.metric||metric===state.metric)),'实测指标/type映射不匹配');assert.ok(['all','changes','growth','decrease','unchanged','entered','exited','exceptions'].includes(state.status),'实测status无效');assert.ok(/^(path|b|c|delta):(asc|desc)$/.test(state.sort),'实测sort无效');assert.ok(typeof state.query==='string'&&typeof state.directory==='string'&&['all','directory'].includes(state.searchScope),'实测范围或query无效');assert.ok(state.exactFile==null||typeof state.exactFile==='string','实测exactFile无效');if(state.numberFilter){const n=state.numberFilter;assert.ok(['b','c','delta','increase','decrease'].includes(n.field)&&['gte','lte','between'].includes(n.operator)&&Number.isFinite(n.value)&&(n.operator!=='between'||Number.isFinite(n.upper)&&n.upper>=n.value),'实测数值条件无效');}}

 const input=path.resolve(inputArg),htmlPath=path.resolve(htmlArg),out=path.resolve(outArg||`output/unified-prototype/stage5-oracle-${new Date().toISOString().replace(/[:.]/g,'-')}`);
 assert.ok(path.basename(out).startsWith('stage5-oracle-'),'输出目录必须命名为 stage5-oracle-*');fs.mkdirSync(out,{recursive:true});assert.ok(!fs.existsSync(path.join(out,'result.json')),'不覆盖已有结果');
 const result={protocol:'raw-scale-oracle-1',nodeVersion:process.version,platform:process.platform,arch:process.arch,scriptSha256:await digestFile(__filename),started:new Date().toISOString(),input,htmlPath,limitation:'仅 Node VM 结果正确性与已保存DOM样本回放核验；不执行DOM、不代表浏览器交互或性能验收；不调用 capacity query 或 bench。',projection:['path','name','b','c','delta','flags','changed','ambiguous','transitionKnown','beforeCount','afterCount','line','thresholdChanged'],metricMapping:metrics.map(([metric,type])=>({metric,type,taskPrefix:type+'.'})),inputs:{},tasks:[],failed:0};
 const save=()=>fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
 try{
 const reports={};for(const side of ['baseline','current']){const file=path.join(input,side+'.json');result.inputs[side]={sha256:await digestFile(file),bytes:fs.statSync(file).size};reports[side]=JSON.parse(fs.readFileSync(file,'utf8'));}
 const manifest=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'),'utf8')),prefix=manifest.root.replace(/\/$/,'')+'/';
 const rel=p=>{if(p===prefix.slice(0,-1))return '';assert.ok(p.startsWith(prefix),'扫描根不匹配：'+p);return p.slice(prefix.length);};
 const paths=[...new Set(Object.values(reports).flatMap(r=>Object.keys(r.detail_metrics.file_sizes).map(rel)))].sort(text),fileMap=new Map(paths.map((p,i)=>[p,i]));
 const files=paths.map(p=>({path:p,b:null,c:null,db:0,dc:0,mb:0,mc:0})),methods=new Map(),positions={unsafe:new Map(),redundant:new Map()},directories=new Map();
 const sideStats={};
 for(const [side,tag] of [['baseline','b'],['current','c']]){
  const d=reports[side].detail_metrics,counts=new Map();
  for(const [full,triple] of Object.entries(d.file_sizes)){
   const p=rel(full),f=files[fileMap.get(p)];for(const v of triple)normalNumber(v,full);f[tag]=triple[0];f['d'+tag]=triple[2];
   const parts=p.split('/');for(let i=0;i<parts.length;i++){const parent=parts.slice(0,i).join('/');if(!counts.has(parent))counts.set(parent,new Set());counts.get(parent).add(parts[i]);}
  }
  for(const [p,members] of counts){if(!directories.has(p))directories.set(p,{path:p,b:0,c:0,kb:null,kc:null});directories.get(p)[tag]=members.size;}
  for(const [full,value] of Object.entries(d.huge_folders)){normalNumber(value,full);const dir=directories.get(rel(full));assert.ok(dir,'目录未出现在扫描中');dir['k'+tag]=value;}
  assert.ok(d.file_duplication&&typeof d.file_duplication==='object'&&!Array.isArray(d.file_duplication),'缺少 file_duplication');
  for(const group of Object.values(d.file_duplication))for(const full of group){const f=files[fileMap.get(rel(full))];assert.ok(f&&f[tag]!==null,'重复成员必须属于扫描文件');f['m'+tag]=1;}
  let ordinary=0;for(const m of d.method_metrics){if(!Object.hasOwn(m,'file_name'))continue;ordinary++;
   const p=rel(m.file_name),key=JSON.stringify([p,m.method_name]);assert.ok(fileMap.has(p),'函数文件不在扫描中');
   if(!methods.has(key))methods.set(key,{path:p,name:m.method_name,b:0,c:0,bc:0,cc:0,bn:0,cn:0,bh:false,ch:false,bx:false,cx:false});
   const g=methods.get(key),ln=normalNumber(m.nbnc_loc,key),cc=normalNumber(m.cyclomatic_complexity,key),limit=reports[side].summary_metrics.huge_threshold;
   g[tag]+=ln;g[tag+'c']+=cc;g[tag+'n']++;g[tag+'h'] ||= ln>limit.huge_method;g[tag+'x'] ||= cc>limit.huge_cyclomatic_complexity;
  }
  assert.equal(ordinary,reports[side].summary_metrics.methods_total,'全部普通函数数量');sideStats[side]={files:Object.keys(d.file_sizes).length,ordinaryMethods:ordinary};
  for(const [full,names] of Object.entries(d.unsafe_functions))for(const [name,lines] of Object.entries(names))for(const line of lines){const p=rel(full),key=JSON.stringify([p,name,line]);if(!positions.unsafe.has(key))positions.unsafe.set(key,{path:p,name,line,b:0,c:0});positions.unsafe.get(key)[tag]=1;}
  for(const [full,lines] of Object.entries(d.redundant_code)){const seen=new Map();for(const line of lines){const p=rel(full),n=seen.get(line)||0;seen.set(line,n+1);const key=JSON.stringify([p,line,n]);if(!positions.redundant.has(key))positions.redundant.set(key,{path:p,name:'冗余代码',line,occurrence:n,b:0,c:0});positions.redundant.get(key)[tag]=1;}}
  // 释放巨大 raw 记录；所有预期需要的原始值和成员关系已经独立汇总。
  delete d.method_metrics;
 }
 result.raw=sideStats;
 const methodRows=[...methods.values()].sort((a,b)=>text(a.path,b.path)||text(a.name,b.name));methods.clear();
 const positionRows=Object.fromEntries(Object.entries(positions).map(([type,map])=>[type,[...map.values()].sort((a,b)=>text(a.path,b.path)||(type==='unsafe'?text(a.name,b.name):0)||a.line-b.line||(a.occurrence||0)-(b.occurrence||0))]));
 const folderRows=[...directories.values()].sort((a,b)=>text(a.path,b.path));
 const limits=type=>['baseline','current'].map(s=>normalNumber(reports[s].summary_metrics.huge_threshold[thresholds[type]],type));
 function expected(type){
  const method=['methodLines','cc','hugeMethod','hugeCC'].includes(type),position=['unsafe','redundant'].includes(type),folder=type==='folders',cc=type==='cc'||type==='hugeCC',threshold=thresholds[type],lim=threshold?limits(type):null;
  const rows=[];for(const raw of method?methodRows:position?positionRows[type]:folder?folderRows:files){
   if(['sourceDuplication','sourceDupfiles','hugeSource'].includes(type)&&header(raw.path)||type==='hugeHeader'&&!header(raw.path))continue;
   let b,c,before,after,ambiguous=false;
   if(method){b=raw[cc?'bc':'b'];c=raw[cc?'cc':'c'];before=raw.bn>0;after=raw.cn>0;ambiguous=raw.bn>1||raw.cn>1;if(threshold&&!(raw[type==='hugeCC'?'bx':'bh']||raw[type==='hugeCC'?'cx':'ch']))continue;}
   else if(folder){if(raw.kb===null&&raw.kc===null)continue;b=raw.kb??raw.b;c=raw.kc??raw.c;before=raw.kb!==null;after=raw.kc!==null;}
   else if(position){b=raw.b;c=raw.c;before=!!b;after=!!c;}
   else{b=raw.b??0;c=raw.c??0;before=raw.b!==null;after=raw.c!==null;if(type.includes('Duplication')||type==='duplication'){b=raw.db;c=raw.dc;}if(type.includes('Dupfiles')||type==='dupfiles'){b=raw.mb;c=raw.mc;if(!b&&!c)continue;}if(threshold&&!(b>lim[0]||c>lim[1]))continue;}
   let entered=!before&&after,exited=before&&!after,known=threshold&&!folder?!ambiguous:true;
   if(type==='dupfiles'||type==='sourceDupfiles'){entered=!b&&!!c;exited=!!b&&!c;}
   if(threshold&&!folder){entered=known&&b<=lim[0]&&c>lim[1];exited=known&&b>lim[0]&&c<=lim[1];}
   const mismatch=folder&&((raw.kb!==null&&raw.kb!==raw.b)||(raw.kc!==null&&raw.kc!==raw.c));
   if(folder&&!mismatch){entered=raw.b<=lim[0]&&raw.c>lim[1];exited=raw.b>lim[0]&&raw.c<=lim[1];}if(mismatch)known=false;
   const delta=c-b,flags=[];if(ambiguous)flags.push('ambiguous');if(mismatch)flags.push('incomparable');if(!mismatch&&delta>0)flags.push('growth');if(!mismatch&&delta<0)flags.push('decrease');if(known&&entered)flags.push('entered');if(known&&exited)flags.push('exited');
   const changedThreshold=!!lim&&lim[0]!==lim[1];rows.push({_ordinal:rows.length,path:raw.path,name:method||position?raw.name:raw.path.slice(raw.path.lastIndexOf('/')+1),b,c,delta,flags,ambiguous,transitionKnown:known,changed:ambiguous||delta!==0||changedThreshold&&known&&(entered||exited)||mismatch,thresholdChanged:changedThreshold,...(method?{beforeCount:raw.bn,afterCount:raw.cn}:{}),...(position?{line:raw.line,_occurrence:raw.occurrence||0}:{})});
  }return rows;
 }
 let html=fs.readFileSync(htmlPath,'utf8');result.htmlSha256=await digestFile(htmlPath);
 if(statesArg)result.measuredSource={path:path.resolve(statesArg),sha256:await digestFile(statesArg),samples:measuredStates.length,kind:measurement?'capacity-results':'states-only',artifactAndInputsBound:false};
 if(measurement){assert.equal(measurement.artifact?.sha256,result.htmlSha256,'实测HTML摘要不匹配');for(const side of ['baseline','current']){const recorded=measurement.inputs?.find(item=>path.basename(item.path)===side+'.json');assert.equal(recorded?.sha256,result.inputs[side].sha256,'实测输入摘要不匹配：'+side);}result.measuredSource.artifactAndInputsBound=true;}
 const source=html.match(/<script type="text\/plain" id="report-worker">([\s\S]*?)<\/script>/)?.[1];assert.ok(source,'缺少 report-worker');result.workerSha256=sha().update(source).digest('hex');
 let response,id=0;const context=vm.createContext({self:{postMessage:m=>{response=m;}},performance,structuredClone,atob,Blob,DecompressionStream,Response,TextDecoder,Uint8Array,Uint32Array,Int32Array,DataView,console});vm.runInContext(source,context,{filename:'report-worker.js'});
 const send=async message=>{response=null;await context.self.onmessage({data:{...message,id:++id}});assert.equal(response?.id,id);if(response.type==='error')throw new Error(response.message);};
 for(const match of html.matchAll(/<script type="application\/octet-stream" data-block-kind="([^"]+)">([\s\S]*?)<\/script>/g))await send({op:'load',kind:match[1],b64:match[2]});await send({op:'finish'});html=null;
 const statusNames=['all','changes','growth','decrease','unchanged','entered','exited','exceptions'];
 const exception=r=>r.flags.includes('ambiguous')||r.flags.includes('incomparable')||r.flags.includes('unknown');
 const status=(r,s)=>s==='all'||(s==='changes'?r.changed:s==='unchanged'?r.delta===0&&!(r.thresholdChanged&&(r.flags.includes('entered')||r.flags.includes('exited')))&&!exception(r):s==='exceptions'?exception(r):r.flags.includes(s));
 function number(r,n){if(!n)return true;let v=r[n.field];if(n.field==='increase'||n.field==='decrease'){if(r.flags.includes('incomparable'))return false;if(n.field==='increase'?r.delta<=0:r.delta>=0)return false;v=n.field==='increase'?r.delta:-r.delta;}return n.operator==='gte'?v>=n.value:n.operator==='lte'?v<=n.value:v>=n.value&&v<=n.upper;}
 for(const type of [...new Set(metrics.map(m=>m[1]))]){
  const rows=expected(type),sample=rows.find(r=>r.name&&r.name!==r.path)||rows[0],middle=rows.length?rows[Math.floor(rows.length/2)].c:0;
  const cases=[{label:'metric-default',status:'changes',sort:'delta:desc'},...measuredStates.filter(item=>stateOf(item).type===type).map((entry,index)=>({...stateOf(entry),label:'measured-'+index,...(entry.sample?{sample:entry.sample}:{})})),...statusNames.map(s=>({label:'status-'+s,status:s})),...['path:desc','b:asc','c:desc','delta:desc','delta:asc'].map(sort=>({label:'sort-'+sort,sort})),{label:'number-current',numberFilter:{field:'c',operator:'gte',value:middle}},{label:'number-baseline',numberFilter:{field:'b',operator:'lte',value:middle}},{label:'number-delta-range',numberFilter:{field:'delta',operator:'between',value:-20,upper:20}},{label:'number-increase',numberFilter:{field:'increase',operator:'gte',value:1}},{label:'number-decrease',numberFilter:{field:'decrease',operator:'gte',value:1}},{label:'name',query:sample?.name||'__absent__'},{label:'combined',query:sample?.name||'__absent__',numberFilter:{field:'c',operator:'gte',value:0},sort:'delta:desc'},{label:'absent',query:'__raw_oracle_absent_978123__'}];
  for(const item of cases){
   const {sample:measuredSample,...queryItem}=item;
   const state={scenario:'normal',type,directory:'',searchScope:'all',exactFile:null,query:'',numberFilter:null,status:'all',sort:'path:asc',page:1,pageSize:7,...queryItem};
   const scope=state.exactFile||(state.searchScope==='all'?'':state.directory);
   const scoped=rows.filter(r=>state.exactFile?r.path===scope:!scope||r.path===scope||r.path.startsWith(scope+'/'));
   const filtered=scoped.filter(r=>(!state.query||`${r.path} ${r.name}`.toLowerCase().includes(state.query.trim().toLowerCase()))&&number(r,state.numberFilter));
   const counts=Object.fromEntries(statusNames.map(s=>[s,filtered.filter(r=>status(r,s)).length]));
   const [field,direction]=state.sort.split(':'),sign=direction==='asc'?1:-1;
   const wanted=filtered.filter(r=>status(r,state.status)).sort((a,b)=>field==='path'?sign*(a._ordinal-b._ordinal):field==='delta'&&(a.flags.includes('incomparable')||b.flags.includes('incomparable'))?Number(a.flags.includes('incomparable'))-Number(b.flags.includes('incomparable'))||a._ordinal-b._ordinal:sign*(a[field]-b[field])||a._ordinal-b._ordinal);
   const expectedHash=sha();for(const r of wanted)expectedHash.update(JSON.stringify(projection(r))+'\n');const expectedSha256=expectedHash.digest('hex');
   context.oracleState=state;const first=vm.runInContext('uiSetContext("normal");uiQuery(oracleState)',context),actualHash=sha();let seen=0,firstMismatch=null;
   context.oracleVisit=r=>{const a=JSON.stringify(projection(r)),e=wanted[seen]&&JSON.stringify(projection(wanted[seen]));if(a!==e&&!firstMismatch)firstMismatch={index:seen,expected:wanted[seen]?projection(wanted[seen]):null,actual:projection(r)};actualHash.update(a+'\n');seen++;};
   vm.runInContext('(()=>{const source=uiSource(oracleState.type);for(const id of UI.query.ids)oracleVisit(source.row(id));})()',context);
   const actualSha256=actualHash.digest('hex'),errors=[];if(first.total!==wanted.length||seen!==wanted.length)errors.push('完整数量');if(actualSha256!==expectedSha256)errors.push('完整序列 SHA256');if(JSON.stringify(counts)!==JSON.stringify(first.counts))errors.push('状态计数');if(first.scopeCount!==scoped.length)errors.push('完整范围数量');
   // 首、深、末页独立经过真实 uiQuery/detail，完整序列由上面的逐 ID 投影核验。
   const browserPages=[];
   const identity=r=>['methodLines','cc','hugeMethod','hugeCC'].includes(type)?'method:'+JSON.stringify([r.path,r.name]):type==='folders'?'folder:'+r.path:type==='unsafe'?'unsafe:'+JSON.stringify([r.path,r.name,r.line]):type==='redundant'?'redundant:'+JSON.stringify([r.path,r.line,r._occurrence]):'file:'+r.path;
   for(const pageSize of [7,10])for(const page of [...new Set([1,51,Math.ceil(wanted.length/pageSize)||1])]){
    context.oracleState={...state,page,pageSize};const got=vm.runInContext('uiQuery(oracleState)',context),p=wanted.length?Math.min(page,Math.ceil(wanted.length/pageSize)):0,expectedRows=wanted.slice(Math.max(0,p-1)*pageSize,p*pageSize);
    if(got.page!==p||got.pages!==Math.ceil(wanted.length/pageSize)||got.total!==wanted.length)errors.push('分页元数据 '+pageSize+':'+page);
    if(JSON.stringify(got.rows.map(projection))!==JSON.stringify(expectedRows.map(projection)))errors.push('分页 '+pageSize+':'+page);
    const expectedIds=expectedRows.map(identity);if(JSON.stringify(got.rows.map(r=>r.id))!==JSON.stringify(expectedIds))errors.push('分页ID '+pageSize+':'+page);
    if(pageSize===10)browserPages.push({page:p,pageSize,expectedIds});
   }
   let measuredDom=null;
   if(measuredSample){
    const pageSize=measuredSample.pageSize??10,requestedPage=measuredSample.page;
    assert.ok(Number.isInteger(pageSize)&&pageSize>=1&&pageSize<=200&&Number.isInteger(requestedPage)&&requestedPage>=0,'实测页码/pageSize无效');
    const page=wanted.length?Math.max(1,Math.min(requestedPage,Math.ceil(wanted.length/pageSize))):0;
    const expectedIds=wanted.slice(Math.max(0,page-1)*pageSize,page*pageSize).map(identity),hasIds=Object.hasOwn(measuredSample,'ids');
    if(measuredSample.total!==wanted.length)errors.push('实测DOM总数');if(requestedPage!==page)errors.push('实测DOM页码');
    if(hasIds&&JSON.stringify(measuredSample.ids)!==JSON.stringify(expectedIds))errors.push('实测DOM ID');
    measuredDom={task:measuredSample.task,run:measuredSample.run,mode:measuredSample.mode,page,pageSize,expectedIds,actualIds:hasIds?measuredSample.ids:null,expectedTotal:wanted.length,actualTotal:measuredSample.total,idsCaptured:hasIds,limitation:hasIds?null:'原始样本未采集DOM ID，仅核验总数/页码与完整Worker序列'};
   }
   const task={id:type+'.'+item.label,metrics:metrics.filter(m=>m[1]===type).map(m=>m[0]),state,scopeCount:scoped.length,expectedCount:wanted.length,actualCount:seen,expectedSha256,actualSha256,counts,actualCounts:first.counts,browserPages,...(measuredDom?{measuredDom}:{}),pass:errors.length===0,errors,...(firstMismatch?{firstMismatch}:{})};result.tasks.push(task);if(!task.pass)result.failed++;fs.appendFileSync(path.join(out,'tasks.jsonl'),JSON.stringify(task)+'\n');save();console.log(`${task.pass?'PASS':'FAIL'} ${task.id} count=${seen} sha256=${actualSha256}`);
  }
 }
 result.finished=new Date().toISOString();result.taskCount=result.tasks.length;result.pass=result.failed===0;save();process.exitCode=result.failed?1:0;
 }catch(error){result.error=error.stack;result.pass=false;save();throw error;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
