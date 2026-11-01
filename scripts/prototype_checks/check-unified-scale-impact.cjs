/* 十二项净影响满规模独立有理数核验：完整排名、对象值、守恒、标尺及首/50/51/末页。
 * 预期仅来自原始JSON，BigInt保留公共分母和排名；Node结果不代表DOM性能。
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const definitions={lines_per_file:['code_size','files_total','code'],lines_per_method:['method_lines','methods_total','method'],cyclomatic_complexity_per_method:['cyclomatic_complexity_total','methods_total','cc'],code_duplication_ratio:['code_duplication_total','code_size','duplication'],file_duplication_ratio:['file_duplication_total','files_total','whole'],non_hfile_code_duplication_ratio:['non_hfile_code_duplication_total','code_size','sourceDuplication'],non_hfile_duplication_ratio:['non_hfile_duplication_total','files_total','sourceWhole'],huge_headerfile_ratio:['huge_headerfile_total','files_total','hugeHeader'],huge_non_headerfile_ratio:['huge_non_headerfile_total','files_total','hugeSource'],huge_method_ratio:['huge_method_total','methods_total','hugeMethod'],huge_cyclomatic_complexity_ratio:['huge_cyclomatic_complexity_total','methods_total','hugeCC'],huge_folder_ratio:['huge_folder_total','folders_total','folders']};
const integer=(value,label)=>{assert.ok(Number.isSafeInteger(value)&&value>=0,label+' 必须是非负安全整数');return BigInt(value);};
const text=(a,b)=>a<b?-1:a>b?1:0,abs=n=>n<0n?-n:n,header=p=>/\.(h|hh|hpp|hxx)$/.test(p),scopeHas=(p,s)=>!s||p===s||p.startsWith(s+'/'),sha=()=>crypto.createHash('sha256');
(async()=>{
 const [inputArg,htmlArg,outArg]=process.argv.slice(2);assert(inputArg&&htmlArg&&outArg,'用法：node check-unified-scale-impact.cjs 输入目录 HTML 新输出目录');
 const input=path.resolve(inputArg),out=path.resolve(outArg);assert(!fs.existsSync(out),'不覆盖原始证据');fs.mkdirSync(out,{recursive:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'),'utf8')),root=manifest.root.replace(/\/$/,'')+'/',rel=p=>{assert(p.startsWith(root));return p.slice(root.length);},data={},inputs={};
 for(const side of ['baseline','current']){
  const raw=fs.readFileSync(path.join(input,side+'.json'));inputs[side]=sha().update(raw).digest('hex');const report=JSON.parse(raw),detail=report.detail_metrics,summary=report.summary_metrics;
  const files=new Map(Object.entries(detail.file_sizes).map(([p,v])=>[rel(p),v])),methods=new Map(),dirs=new Map(),whole=new Set(Object.values(detail.file_duplication).flat().map(rel)),limits=summary.huge_threshold;
  for(const p of files.keys()){const parts=p.split('/');for(let i=0;i<parts.length;i++){const parent=parts.slice(0,i).join('/');if(!dirs.has(parent))dirs.set(parent,new Set());dirs.get(parent).add(parts[i]);}}
  for(const m of detail.method_metrics){if(!Object.hasOwn(m,'file_name'))continue;const p=rel(m.file_name);if(!methods.has(p))methods.set(p,{n:0n,c:0n,d:0n,hm:0n,hc:0n});const value=methods.get(p);assert(files.has(p),'函数文件必须属于本侧扫描集合');value.n+=integer(m.nbnc_loc,p+' 函数行数');value.c+=integer(m.cyclomatic_complexity,p+' 圈复杂度');value.d++;value.hm+=BigInt(m.nbnc_loc>limits.huge_method);value.hc+=BigInt(m.cyclomatic_complexity>limits.huge_cyclomatic_complexity);}
  data[side]={files,methods,dirs,whole,summary,limits};
 }
 function objects(side,scope,metric){
  const {files,methods,dirs,whole,limits}=data[side],[,denominator,type]=definitions[metric],result=new Map();
  if(type==='folders'){for(const [p,members] of dirs)if(scopeHas(p,scope))result.set(p,{n:BigInt(members.size>limits.huge_folder),d:1n});return result;}
  for(const [p,values] of files){if(!scopeHas(p,scope))continue;let n=0n,d=denominator==='code_size'?integer(values[0],p+' 代码行数'):1n;const method=methods.get(p)||{n:0n,c:0n,d:0n,hm:0n,hc:0n};
   if(denominator==='methods_total'){d=method.d;n=type==='method'?method.n:type==='cc'?method.c:type==='hugeMethod'?method.hm:method.hc;}
   else if(type==='code')n=integer(values[0],p+' 代码行数');else if(type==='duplication'||type==='sourceDuplication')n=type==='sourceDuplication'&&header(p)?0n:integer(values[2],p+' 重复行数');else if(type==='whole'||type==='sourceWhole')n=BigInt(whole.has(p)&&(type!=='sourceWhole'||!header(p)));else if(type==='hugeHeader')n=BigInt(header(p)&&values[0]>limits.huge_headerfile);else if(type==='hugeSource')n=BigInt(!header(p)&&values[0]>limits.huge_non_headerfile);
   result.set(p,{n,d});
  }return result;
 }
 const html=fs.readFileSync(htmlArg,'utf8'),source=html.match(/<script type="text\/plain" id="report-worker">([\s\S]*?)<\/script>/)[1];let response,id=0;
 const context=vm.createContext({self:{postMessage:m=>response=m},performance,structuredClone,atob,Blob,DecompressionStream,Response,TextDecoder,Uint8Array,Uint32Array,Int32Array,DataView,console});vm.runInContext(source,context);
 const send=async message=>{response=null;await context.self.onmessage({data:{...message,id:++id}});assert.equal(response.id,id);if(response.type==='error')throw Error(response.message);};
 for(const m of html.matchAll(/data-block-kind="([^"]+)">([^<]+)<\/script>/g))await send({op:'load',kind:m[1],b64:m[2]});await send({op:'finish'});vm.runInContext('uiSetContext("normal")',context);
 const scopes=['',...['src/bulk','src/wide','src/deep'].filter(scope=>Object.values(data).some(side=>side.dirs.has(scope)))],tasks=[];
 const near=(actual,expected,label)=>assert.ok(Number.isFinite(actual)&&Math.abs(actual-expected)<=1e-11*Math.max(1,Math.abs(expected)),label+` ${actual} != ${expected}`);
 for(const scope of scopes)for(const metric of Object.keys(definitions)){
  const before=objects('baseline',scope,metric),after=objects('current',scope,metric),sum=map=>[...map.values()].reduce((a,v)=>({n:a.n+BigInt(v.n),d:a.d+BigInt(v.d)}),{n:0n,d:0n}),b=sum(before),c=sum(after),den=b.d*c.d,scale=metric.endsWith('_ratio')?100:1;
  assert(b.d>0n&&c.d>0n,'正常范围分母必须正');const wanted=[];let total=0n;
  for(const p of new Set([...before.keys(),...after.keys()])){
   const bv=before.get(p)||{n:0n,d:0n},cv=after.get(p)||{n:0n,d:0n},dn=cv.n-bv.n,dd=bv.d-cv.d,num=dn*c.d+c.n*dd,strength=abs(dn)*c.d+c.n*abs(dd);
   if(dn!==0n||c.n*dd!==0n){wanted.push({path:p,b:bv,c:cv,num,strength,dn,dd});total+=num;}
  }
  assert.equal(total,c.n*b.d-b.n*c.d,'固定分解完整总量守恒');wanted.sort((a,b)=>abs(a.num)>abs(b.num)?-1:abs(a.num)<abs(b.num)?1:a.strength>b.strength?-1:a.strength<b.strength?1:text(a.path,b.path));
  context.impactState={scenario:'normal',metric,directory:scope,searchScope:'directory',contributionPage:1};const actual=vm.runInContext('uiImpact(impactState)',context),all=vm.runInContext('uiImpactCache.contributions',context);
  assert.equal(actual.scope,scope,'返回范围');assert.equal(actual.ranking.pages,Math.ceil(wanted.length/5),'完整排名页数');
  assert.equal(actual.issues.length,0,metric+' '+scope+' 不应受限：'+JSON.stringify(actual.issues));assert(actual.effects);assert.equal(all.length,wanted.length,'完整排名数量');assert.equal(actual.ranking.total,wanted.length);
  for(const [tag,stats] of [['baseline',b],['current',c]]){assert.equal(integer(actual[tag].numerator,tag+' 汇总分子'),stats.n);assert.equal(integer(actual[tag].denominator,tag+' 汇总分母'),stats.d);near(actual[tag].value,Number(stats.n)/Number(stats.d)*scale,tag+' 值');}
  near(actual.effects.numerator,Number(c.n-b.n)/Number(b.d)*scale,'全范围分子影响');near(actual.effects.denominator,Number(c.n*(b.d-c.d))/Number(den)*scale,'全范围分母影响');near(actual.effects.delta,Number(total)/Number(den)*scale,'全范围净变化');near(actual.observedDelta,Number(total)/Number(den)*scale,'观测差值');
  const expectedHash=sha(),actualHash=sha();let cancellations=0;
  for(let i=0;i<wanted.length;i++){
   const w=wanted[i],a=all[i];assert.equal(a.path,w.path,'完整绝对值排名');assert.equal(integer(a.before.numerator,'返回对象值'),w.b.n);assert.equal(integer(a.before.denominator,'返回对象值'),w.b.d);assert.equal(integer(a.after.numerator,'返回对象值'),w.c.n);assert.equal(integer(a.after.denominator,'返回对象值'),w.c.d);
   near(a.value,Number(w.num)/Number(den)*scale,'对象净影响');near(a.numerator,Number(w.dn)/Number(b.d)*scale,'对象分子影响');near(a.denominator,Number(c.n*w.dd)/Number(den)*scale,'对象分母影响');
   const expected=[w.path,Number(w.b.n),Number(w.b.d),Number(w.c.n),Number(w.c.d),w.num.toString(),den.toString()],actualNum=(BigInt(a.after.numerator)-BigInt(a.before.numerator))*c.d+c.n*(BigInt(a.before.denominator)-BigInt(a.after.denominator)),observed=[a.path,a.before.numerator,a.before.denominator,a.after.numerator,a.after.denominator,actualNum.toString(),den.toString()];expectedHash.update(JSON.stringify(expected)+'\n');actualHash.update(JSON.stringify(observed)+'\n');if(w.num===0n)cancellations++;
  }
  const expectedSha256=expectedHash.digest('hex'),actualSha256=actualHash.digest('hex');assert.equal(actualSha256,expectedSha256);const maximum=wanted.length?Number(abs(wanted[0].num))/Number(den)*scale:0;near(actual.ranking.maximum,maximum,'全范围标尺');
  const pages=[];for(const requested of [1,50,51,1e9]){context.impactState.contributionPage=requested;const result=vm.runInContext('uiImpact(impactState)',context),p=wanted.length?Math.min(requested,Math.ceil(wanted.length/5)):0;assert.equal(result.scope,scope,'分页范围');assert.equal(result.ranking.page,p);assert.equal(result.ranking.pages,Math.ceil(wanted.length/5),'分页总页数');assert.equal(result.ranking.total,wanted.length);assert.equal(result.ranking.maximum,actual.ranking.maximum);const start=Math.max(0,p-1)*5;assert.deepEqual(JSON.parse(JSON.stringify(result.contributions.map(r=>r.path))),wanted.slice(start,p*5).map(r=>r.path));
   for(let j=0;j<result.contributions.length;j++){const a=result.contributions[j],w=wanted[start+j];near(a.value,Number(w.num)/Number(den)*scale,'分页对象净影响');near(a.numerator,Number(w.dn)/Number(b.d)*scale,'分页对象分子影响');near(a.denominator,Number(c.n*w.dd)/Number(den)*scale,'分页对象分母影响');assert.equal(integer(a.before.numerator,'分页基线分子'),w.b.n);assert.equal(integer(a.before.denominator,'分页基线分母'),w.b.d);assert.equal(integer(a.after.numerator,'分页当前分子'),w.c.n);assert.equal(integer(a.after.denominator,'分页当前分母'),w.c.d);} pages.push({requested,page:p,paths:JSON.parse(JSON.stringify(result.contributions.map(r=>r.path)))});}
  context.impactState={scenario:'normal',metric,directory:scope,searchScope:'directory',contributionPage:1,query:'__absent__',status:'growth',page:999,exactFile:'__other__',numberFilter:{op:'gt',value:999999}};
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('uiImpact(impactState)',context))),JSON.parse(JSON.stringify(actual)),'表内条件不应改变净影响范围');
  if(scope){context.impactState={scenario:'normal',metric,directory:scope,searchScope:'all',contributionPage:1};const global=vm.runInContext('uiImpact(impactState)',context);context.impactState.directory='';assert.deepEqual(JSON.parse(JSON.stringify(global)),JSON.parse(JSON.stringify(vm.runInContext('uiImpact(impactState)',context))),'all 必须忽略目录');assert.equal(global.scope,'');}
  tasks.push({metric,scope,total:wanted.length,cancellations,expectedSha256,actualSha256,globalNumerator:total.toString(),globalDenominator:den.toString(),scale,maximum,pages,pass:true});console.log('PASS '+metric+' '+(scope||'全报告')+' '+wanted.length);
 }
 const result={protocol:'full-impact-rational-1',inputs,htmlSha256:sha().update(html).digest('hex'),workerSha256:sha().update(source).digest('hex'),checks:tasks.length,failed:0,tasks,limitation:'完整BigInt原始分子/分母排名与守恒核验；浮点展示允许1e-11相对误差；Node不代表DOM性能'};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({checks:tasks.length,failed:0,out}));
})().catch(error=>{console.error(error);process.exitCode=1;});
