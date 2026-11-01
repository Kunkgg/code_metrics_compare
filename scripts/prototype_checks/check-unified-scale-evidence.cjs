/* 大规模证据：独立raw集合对照完整过滤集合SHA256，再核对首/50/51/末页。
 * 只证明真实Worker查询正确性，不用Node耗时冒充浏览器性能。
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const hash=rows=>{const h=crypto.createHash('sha256');for(const row of rows)h.update(JSON.stringify(row)+'\n');return h.digest('hex');};
(async()=>{
 const [inputArg,htmlArg,outArg]=process.argv.slice(2);assert(inputArg&&htmlArg&&outArg,'用法：node check-unified-scale-evidence.cjs 输入目录 HTML 新输出目录');
 const input=path.resolve(inputArg),out=path.resolve(outArg);assert(!fs.existsSync(out),'不覆盖原始证据');fs.mkdirSync(out,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'),'utf8')),root=manifest.root.replace(/\/$/,'')+'/',rel=p=>{assert(p.startsWith(root));return p.slice(root.length);};
 const reports={},directories=new Map(),inputs={};
 for(const [side,tag] of [['baseline','b'],['current','c']]){
  const raw=fs.readFileSync(path.join(input,side+'.json'));inputs[side]=crypto.createHash('sha256').update(raw).digest('hex');const report=JSON.parse(raw),d=report.detail_metrics;delete d.method_metrics;reports[side]=d;
  for(const full of Object.keys(d.file_sizes)){
   const parts=rel(full).split('/');for(let i=0;i<parts.length;i++){
    const parent=parts.slice(0,i).join('/'),member=parts.slice(0,i+1).join('/');if(!directories.has(parent))directories.set(parent,new Map());
    const map=directories.get(parent);if(!map.has(member))map.set(member,{path:member,name:parts[i],type:i===parts.length-1?'文件':'目录',before:false,after:false});map.get(member)[tag==='b'?'before':'after']=true;
   }
  }
 }
 const types={duplication:'code_duplication',sourceDuplication:'code_duplication',dupfiles:'file_duplication',sourceDupfiles:'file_duplication'};
 const expectedFor=(type,anchor,groups)=>{
  const whole=types[type]==='file_duplication',result={},peers=new Set();
  for(const side of ['baseline','current']){
   const entries=Object.entries(reports[side][types[type]]).filter(([,members])=>members.some(m=>rel(whole?m:m.file_name)===anchor));
   result['groups-'+side]=entries.map(([id])=>id);
   for(const [,members] of entries)for(const m of members){const p=rel(whole?m:m.file_name);if(p!==anchor)peers.add(p);}
   const active=entries.find(([id])=>id===groups[side])||entries[0];result['fragments-'+side]=active?active[1].map(m=>whole?rel(m):`${rel(m.file_name)} ${m.start_line} ${m.code_duplication}`):[];
  }
  result.peers=[...peers].sort();return result;
 };
 const html=fs.readFileSync(htmlArg,'utf8'),match=html.match(/<script type="text\/plain" id="report-worker">([\s\S]*?)<\/script>/);assert(match,'缺少内嵌Worker');const source=match[1];let response,id=0;
 const context=vm.createContext({self:{postMessage:m=>response=m},performance,structuredClone,atob,Blob,DecompressionStream,Response,TextDecoder,Uint8Array,Uint32Array,Int32Array,DataView,console});vm.runInContext(source,context);
 const send=async message=>{response=null;await context.self.onmessage({data:{...message,id:++id}});assert.equal(response.id,id);if(response.type==='error')throw Error(response.message);return response.payload??response;};
 for(const m of html.matchAll(/data-block-kind="([^"]+)">([^<]+)<\/script>/g))await send({op:'load',kind:m[1],b64:m[2]});await send({op:'finish'});
 let captures=[];
 context.evidenceCapture=rows=>captures.push({count:rows.length,sha256:hash(rows)});
 vm.runInContext(`{
  const originalEvidencePage=uiEvidencePage;
  uiEvidencePage=function(items,query,requested,text){
   const originalPage=uiPage;
   uiPage=function(filtered,page,size){
    evidenceCapture(filtered.map(item=>typeof item==='object'?[item.path,item.type,item.before,item.after,item.status]:text(item)));
    return originalPage(filtered,page,size);
   };
   try{return originalEvidencePage(items,query,requested,text);}finally{uiPage=originalPage;}
  };
 }`,context);
 const tasks=[],base={scenario:'normal',view:'workspace',metric:'code_size',directory:'',searchScope:'all',query:'',status:'all',sort:'path:asc',page:1,pageSize:10,directoryPage:1,chartPage:1,overviewChanges:['growth','decrease']};
 for(const type of Object.keys(types)){
  const whole=types[type]==='file_duplication';let best=null;
  for(const side of ['baseline','current'])for(const [group,members] of Object.entries(reports[side][types[type]])){
   const candidates=members.map(m=>rel(whole?m:m.file_name)).filter(p=>!type.startsWith('source')||!/\.(h|hh|hpp|hxx)$/.test(p));
   if(candidates.length&&(!best||members.length>best.size))best={anchor:candidates[0],size:members.length,group};
  }
  assert(best,'缺少实际大规模关联组：'+type);const groups={};
  for(const side of ['baseline','current'])groups[side]=Object.entries(reports[side][types[type]]).find(([,members])=>members.some(m=>rel(whole?m:m.file_name)===best.anchor))?.[0]??null;
  const wanted=expectedFor(type,best.anchor,groups),keys=['groups-baseline','fragments-baseline','groups-current','fragments-current','peers'];
  for(const query of ['',best.anchor.toUpperCase(),'__NO_MATCH_EVIDENCE_PROOF__'])for(const requested of [1,50,51,1e9]){
   captures=[];const evidenceControls=Object.fromEntries(keys.map(key=>[key,{page:requested,query}]));
   const snapshot=await send({op:'snapshot',state:{...base,type,exactFile:best.anchor,selected:'file:'+best.anchor,groups,evidenceControls}});
   assert.equal(captures.length,5);
   for(let k=0;k<keys.length;k++){
    const key=keys[k],expected=wanted[key].filter(row=>String(row).toLowerCase().includes(query.toLowerCase())),actual=captures[k];assert.equal(actual.count,expected.length,key+' 完整数量');assert.equal(actual.sha256,hash(expected),key+' 完整集合');
    const data=key==='peers'?snapshot.evidence.peers:snapshot.evidence.sides[key.endsWith('baseline')?'baseline':'current'][key.startsWith('groups')?'groups':'members'];
    const actualRows=key==='peers'?data.rows.map(m=>m.path):key.startsWith('groups')?data.rows.map(g=>g.id):data.rows.map(m=>whole?m.path:`${m.path} ${m.start_line} ${m.code_duplication}`);
    const page=expected.length?Math.min(requested,Math.ceil(expected.length/12)):0;assert.deepEqual(JSON.parse(JSON.stringify(actualRows)),expected.slice(Math.max(0,page-1)*12,page*12));
    assert.equal(data.total,expected.length,key+' 分页数量');assert.equal(data.page,page,key+' 页码');assert.equal(data.pages,Math.ceil(expected.length/12),key+' 页数');
    tasks.push({type,anchor:best.anchor,groups,key,query,requested,page,total:expected.length,sha256:actual.sha256,actualRows,pass:true});
   }
  }
 }
 const directory=[...directories].filter(([p])=>Object.hasOwn(reports.baseline.huge_folders,p?root+p:root.slice(0,-1))||Object.hasOwn(reports.current.huge_folders,p?root+p:root.slice(0,-1))).sort((a,b)=>b[1].size-a[1].size)[0];assert(directory,'缺少超大目录');
 const [directoryPath,map]=directory,members=[...map.values()].map(m=>({...m,status:!m.before&&m.after?'entered':m.before&&!m.after?'exited':'same'})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),projection=m=>[m.path,m.type,m.before,m.after,m.status];
 for(const memberStatus of ['all','changes','entered','exited'])for(const query of ['',directoryPath.toUpperCase(),'__NO_MATCH_EVIDENCE_PROOF__'])for(const requested of [1,50,51,1e9]){
  const filtered=members.filter(m=>(memberStatus==='all'||memberStatus==='changes'&&m.status!=='same'||m.status===memberStatus)&&m.path.toLowerCase().includes(query.toLowerCase())).map(projection);
  captures=[];const snapshot=await send({op:'snapshot',state:{...base,type:'folders',metric:'huge_folder_total',directory:directoryPath,selected:'folder:'+directoryPath,memberStatus,memberQuery:query,memberPage:requested}});
  assert.equal(captures.length,1);assert.equal(captures[0].count,filtered.length);assert.equal(captures[0].sha256,hash(filtered));
  const page=Math.min(requested,Math.ceil(filtered.length/12));assert.equal(snapshot.evidence.members.page,page);assert.equal(snapshot.evidence.members.total,filtered.length);assert.equal(snapshot.evidence.members.pages,Math.ceil(filtered.length/12));assert.deepEqual(JSON.parse(JSON.stringify(snapshot.evidence.members.rows.map(projection))),filtered.slice(Math.max(0,page-1)*12,page*12));tasks.push({type:'folders',directory:directoryPath,memberStatus,query,requested,page,total:filtered.length,sha256:captures[0].sha256,actualRows:filtered.slice(Math.max(0,page-1)*12,page*12),pass:true});
 }
 const result={manifestSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(input,'manifest.json'))).digest('hex'),protocol:'full-filtered-evidence-1',inputs,htmlSha256:crypto.createHash('sha256').update(html).digest('hex'),workerSha256:crypto.createHash('sha256').update(source).digest('hex'),checks:tasks.length,failed:0,tasks,limitation:'完整过滤集合独立SHA256＋首/50/51/末页；Node VM不代表DOM或浏览器性能'};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({checks:tasks.length,failed:0,out}));
})().catch(error=>{console.error(error);process.exitCode=1;});
