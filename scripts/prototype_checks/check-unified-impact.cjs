/* 独立整数输入与 BigInt 有理数预期；不读取或修改 Golden。 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const q=(n,d=1n)=>[BigInt(n),BigInt(d)],add=(a,b)=>[a[0]*b[1]+b[0]*a[1],a[1]*b[1]],sub=(a,b)=>add(a,[-b[0],b[1]]),mul=(a,b)=>[a[0]*b[0],a[1]*b[1]],div=(a,b)=>[a[0]*b[1],a[1]*b[0]],num=a=>Number(a[0])/Number(a[1]);
let checks=0;
function near(actual,expected,label){checks++;assert.ok(Number.isFinite(actual)&&Math.abs(actual-num(expected))<1e-9*Math.max(1,Math.abs(num(expected))),`${label}: ${actual} != ${num(expected)}`);}
function equal(a,b,label){checks++;assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),label);}
const definitions=[
 ['lines_per_file','code_size','files_total','code'],['lines_per_method','method_lines','methods_total','methodLines'],['cyclomatic_complexity_per_method','cyclomatic_complexity_total','methods_total','cc'],
 ['code_duplication_ratio','code_duplication_total','code_size','duplication'],['file_duplication_ratio','file_duplication_total','files_total','dupfiles'],['non_hfile_code_duplication_ratio','non_hfile_code_duplication_total','code_size','sourceDuplication'],['non_hfile_duplication_ratio','non_hfile_duplication_total','files_total','sourceDupfiles'],
 ['huge_headerfile_ratio','huge_headerfile_total','files_total','hugeHeader'],['huge_non_headerfile_ratio','huge_non_headerfile_total','files_total','hugeSource'],['huge_method_ratio','huge_method_total','methods_total','hugeMethod'],['huge_cyclomatic_complexity_ratio','huge_cyclomatic_complexity_total','methods_total','hugeCC'],['huge_folder_ratio','huge_folder_total','folders_total','folders']
];
const limits={huge_headerfile:25,huge_non_headerfile:35,huge_method:15,huge_cyclomatic_complexity:3,huge_folder:2};
const inputs={
 baseline:[['src/a.c',10,2,[[10,1],[20,4]],1],['src/b.h',30,4,[[15,3]],1],['src/deep/c.c',40,8,[[30,5]],0],['old/x.c',60,10,[[40,7]],0]],
 current:[['src/a.c',20,5,[[20,2]],1],['src/b.h',40,6,[[16,4],[24,6]],1],['src/deep/c.c',30,6,[[10,3]],1],['new/y.c',70,15,[[50,8]],1]]
};
function dirsOf(rows){const dirs=new Map();for(const [p] of rows){const parts=p.split('/');for(let i=0;i<parts.length;i++){const d=parts.slice(0,i).join('/');if(!dirs.has(d))dirs.set(d,new Set());dirs.get(d).add(parts.slice(0,i+1).join('/'));}}return dirs;}
// 此预期直接对原始文件和函数求和，不调用被测模块的任何辅助函数。
function objects(rows,index,scope=''){
 const type=definitions[index][3],selected=rows.filter(r=>!scope||r[0].startsWith(scope+'/'));
 if(type==='folders')return new Map([...dirsOf(rows)].filter(([p])=>!scope||p===scope||p.startsWith(scope+'/')).map(([p,m])=>[p,[Number(m.size>2),1]]));
 return new Map(selected.map(([p,lines,dup,methods,repeated])=>{
   const header=/\.h$/.test(p);let n,d=1;
   switch(type){case 'code':n=lines;break;case 'methodLines':n=methods.reduce((s,m)=>s+m[0],0);d=methods.length;break;case 'cc':n=methods.reduce((s,m)=>s+m[1],0);d=methods.length;break;
    case 'duplication':n=dup;d=lines;break;case 'sourceDuplication':n=header?0:dup;d=lines;break;case 'dupfiles':n=repeated;break;case 'sourceDupfiles':n=header?0:repeated;break;
    case 'hugeHeader':n=Number(header&&lines>25);break;case 'hugeSource':n=Number(!header&&lines>35);break;case 'hugeMethod':n=methods.filter(m=>m[0]>15).length;d=methods.length;break;case 'hugeCC':n=methods.filter(m=>m[1]>3).length;d=methods.length;break;}
   return [p,[n,d]];
 }));
}
function setup(input){
 const paths=[...new Set(Object.values(input).flatMap(rows=>rows.map(r=>r[0])))].sort(),dirs=[...new Set(Object.values(input).flatMap(rows=>[...dirsOf(rows).keys()]))].sort(),S={paths,F:paths.length,names:['f'],files:{},meta:{summaries:{}},dirs:[],ready:true,dupMember:{}};
 for(const [side,tag] of [['baseline','b'],['current','c']]){
  const rows=input[side],byPath=new Map(rows.map(r=>[r[0],r])),v={fi:[],ln:[],cc:[],valid:[],na:[],st:[],en:[]},range=[0];
  for(const key of ['Ex','N','R','D','Valid'])S.files[tag+key]=[];S.dupMember[side]=[];
  for(let f=0;f<paths.length;f++){
   const r=byPath.get(paths[f]);S.files[tag+'Ex'].push(Number(!!r));S.files[tag+'N'].push(r?.[1]??0);S.files[tag+'R'].push(r?.[1]??0);S.files[tag+'D'].push(r?.[2]??0);S.files[tag+'Valid'].push(7);S.dupMember[side].push(r?.[4]??0);
   for(const [ln,cc] of r?.[3]??[]){v.fi.push(f);v.ln.push(ln);v.cc.push(cc);v.valid.push(3);v.na.push(0);v.st.push(1);v.en.push(ln);}range.push(v.fi.length);
  }
  S[tag==='b'?'mB':'mC']={views:v,count:v.fi.length};S[tag==='b'?'rangeB':'rangeC']=range;
  const summary={huge_threshold:{...limits}};
  for(let i=0;i<12;i++){const o=[...objects(rows,i).values()],n=o.reduce((s,r)=>s+r[0],0),d=o.reduce((s,r)=>s+r[1],0),[key,nk,dk]=definitions[i];summary[nk]=n;summary[dk]=d;summary[key]=d?Math.floor(n/d*(key.endsWith('_ratio')?100:1)*100+0.5)/100:0;}
  S.meta.summaries[side]=summary;
 }
 for(const p of dirs){const d={p,cf:paths.map((v,i)=>[v,i]).filter(([v])=>v.slice(0,v.lastIndexOf('/'))===p).map(([,i])=>i),cd:dirs.map((v,i)=>[v,i]).filter(([v])=>v&&v.slice(0,Math.max(0,v.lastIndexOf('/')))===p).map(([,i])=>i)};
  for(const [side,tag] of [['baseline','b'],['current','c']]){d[tag+'F']=input[side].filter(r=>!p||r[0].startsWith(p+'/')).length;const members=dirsOf(input[side]).get(p)?.size??0;d[tag==='b'?'kB':'kC']=members>2?members:null;}S.dirs.push(d);
 }S.dirByPath=new Map(S.dirs.map((d,i)=>[d.p,i]));
 const context=vm.createContext({S,structuredClone,console,self:{onmessage(){}},performance});
 const source=['prototypes/performance/large_worker.js','prototypes/ui/ui_queries.js','prototypes/ui/ui_impact.js','prototypes/ui/ui_worker.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
 // 保留真实实现，仅把解码后状态注入其 S。
 vm.runInContext(source.replace('const S = {','const unusedDecodedState = {'),context);
 const run=patch=>{context.patch=patch;return vm.runInContext("uiSetContext(patch.scenario||'normal');uiImpact(patch)",context);};
 return {context,S,run};
}
const state={scenario:'normal',directory:'',searchScope:'directory',contributionPage:1};
const {run,context,S}=setup(inputs);
for(const scope of ['', 'src','src/deep','missing'])for(let i=0;i<12;i++){
 const [metric,,,type]=definitions[i],b=objects(inputs.baseline,i,scope),c=objects(inputs.current,i,scope),sum=(o,k)=>[...o.values()].reduce((s,v)=>s+v[k],0),bn=sum(b,0),bd=sum(b,1),cn=sum(c,0),cd=sum(c,1),scale=metric.endsWith('_ratio')?100:1;
 const patch={...state,metric,directory:scope},first=run(patch);
 if(!bd||!cd){equal(first.effects,null,metric+'.zero');equal(first.ranking.total,0,metric+'.suppressed');continue;}
 equal(first.issues,[],metric+'.issues.'+scope);near(first.baseline.value,q(bn*scale,bd),metric+'.baseline');near(first.current.value,q(cn*scale,cd),metric+'.current');
 const n=q((cn-bn)*scale,bd),d=q(cn*(bd-cd)*scale,bd*cd),expected=[];
 near(first.effects.numerator,n,metric+'.numerator-first');near(first.effects.denominator,d,metric+'.denominator-second');near(first.observedDelta,add(n,d),metric+'.delta');
 for(const p of new Set([...b.keys(),...c.keys()])){const before=b.get(p)||[0,0],after=c.get(p)||[0,0],a=q((after[0]-before[0])*scale,bd),z=q(cn*(before[1]-after[1])*scale,bd*cd);if(a[0]||z[0])expected.push({path:p,n:a,d:z,value:add(a,z)});}
 const abs=a=>[a[0]<0n?-a[0]:a[0],a[1]],cmp=(a,b)=>{const v=a[0]*b[1]-b[0]*a[1];return v<0n?-1:v>0n?1:0;};
 expected.sort((a,b)=>cmp(abs(b.value),abs(a.value))||cmp(add(abs(b.n),abs(b.d)),add(abs(a.n),abs(a.d)))||(a.path<b.path?-1:a.path>b.path?1:0));
 const actual=[];for(let page=1;page<=Math.max(1,first.ranking.pages);page++)actual.push(...run({...patch,contributionPage:page}).contributions);
 equal(actual.map(r=>r.path),expected.map(r=>r.path),metric+'.ranking');for(let j=0;j<actual.length;j++){near(actual[j].value,expected[j].value,metric+'.object');near(actual[j].numerator,expected[j].n,metric+'.object-n');near(actual[j].denominator,expected[j].d,metric+'.object-d');}
 near(actual.reduce((s,r)=>s+r.value,0),add(n,d),metric+'.conservation');
 equal(run({...patch,query:'absent',status:'growth',page:999,exactFile:'other',numberFilter:{value:999}}),first,metric+'.scope-independent');
 if(scope)equal(run({...patch,searchScope:'all'}).baseline.numerator,run({...patch,directory:''}).baseline.numerator,metric+'.all-scope');
}
// 大量排名、抵消项、深页和统一最大值；与上一组输入独立。
const many={baseline:[],current:[]};for(let i=0;i<262;i++){const p='scope/'+String(i).padStart(3,'0')+'.c';many.baseline.push([p,10,0,[],0]);many.current.push([p,i%2?9:11,0,[],0]);}many.current.push(['scope/cancel.c',10,0,[],0]);
const paged=setup(many),patch={...state,metric:'lines_per_file'},head=paged.run(patch),all=[];
for(let page=1;page<=head.ranking.pages;page++){const result=paged.run({...patch,contributionPage:page});equal(result.ranking.maximum,head.ranking.maximum,'maximum');assert.ok(result.contributions.length<=5);all.push(...result.contributions);}
equal(all.length,263,'full-ranking');assert.ok(all.some(item=>item.value>0&&item.value<0.005)&&all.some(item=>item.value<0&&item.value>-0.005),'显示舍入为零的正负影响仍保留');checks++;equal(head.ranking.pages,53,'pages');equal(all.at(-1).path,'scope/cancel.c','cancel-retained');near(all.at(-1).value,q(0),'cancel-net');assert.ok(all.at(-1).numerator!==0&&all.at(-1).denominator!==0);
equal(paged.run({...patch,contributionPage:999}).ranking.page,53,'clamp-last');equal(paged.run({...patch,contributionPage:-9}).ranking.page,1,'clamp-first');
// 缺值、真实冲突、未知显示值、阈值变更、目录覆盖分别限制分解。
function mutate(code,metric,pattern){vm.runInContext(code+';uiImpactCache=null',context);const result=run({...state,metric});equal(result.effects,null,metric+'.suppressed');assert.match(result.issues.join(';'),pattern);checks++;return result;}
mutate("S.files.cValid[0]=3",'code_duplication_ratio',/未知/);vm.runInContext('S.files.cValid[0]=7',context);
mutate("S.mC.views.valid[0]=2",'lines_per_method',/未知/);vm.runInContext('S.mC.views.valid[0]=3',context);
mutate("S.mC.views.valid[0]=1",'cyclomatic_complexity_per_method',/未知/);vm.runInContext('S.mC.views.valid[0]=3',context);
mutate("uiContext.summaries.current.code_size+=1",'lines_per_file',/不一致/);vm.runInContext('uiContext.summaries.current.code_size-=1',context);
mutate("uiContext.summaries.current.lines_per_file=null",'lines_per_file',/不一致|未知/);vm.runInContext('uiContext.summaries.current.lines_per_file=S.meta.summaries.current.lines_per_file',context);
const changed=mutate("uiContext.summaries.current.huge_threshold.huge_method=16;uiContext.summaries.current.huge_method_total=3;uiContext.summaries.current.huge_method_ratio=60",'huge_method_ratio',/阈值变化/);assert.ok(Number.isFinite(changed.observedDelta));checks++;
mutate("uiContext.summaries.current.huge_threshold.huge_method=null",'huge_method_ratio',/阈值未知/);
mutate("S.dirs[0].kC=999",'huge_folder_ratio',/不完整/);
const empty=setup({baseline:[],current:[]});for(const [metric] of definitions){const result=empty.run({...state,metric});equal(result.effects,null,'empty.'+metric);equal(result.ranking.total,0,'empty.rank');}
// 真实 snapshot 按约定调用证据模块，排名页保持有界。
vm.runInContext("function uiEvidence(state,row){return {path:row?.path};}",paged.context);
paged.S.meta.thresholdTransitions={};paged.S.meta.maxima={baseline:{},current:{}};
paged.context.snapshotState={...state,metric:'lines_per_file',type:'code',query:'',status:'all',sort:'path:asc',page:1,pageSize:2,overviewChanges:['growth','decrease'],directoryPage:1};
const snapshot=vm.runInContext('uiSnapshot(snapshotState)',paged.context);equal(snapshot.impact.contributions.length,5,'snapshot.bounded-impact');equal(snapshot.evidence.path,snapshot.query.rows[0].path,'snapshot.evidence');equal(snapshot.evidencePending,false,'snapshot.evidence-ready');
console.log(JSON.stringify({checks,failed:0,metrics:12,scopes:['full','directory','nested','missing'],rankingObjects:263,rankingPages:53,oracle:'独立原始整数输入 + BigInt 有理数预期'},null,2));
