/* 真实 JSON → 构建单 HTML → 产物内真实 Worker；未知不能变成业务零或确定进出。 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process');
const {loadWorker}=require('./worker-harness.cjs');

(async()=>{
  const comparison=process.argv.includes('--comparison');
  const output=path.resolve(process.argv[2]||'output/unified-prototype/next-anomalies');
  fs.mkdirSync(output,{recursive:true});
  const root='/golden/project',inputHashes={};
  // 只读取已批准夹具作为扫描结构模板；所有异常写入独立输出，不改 golden。
  for(const side of ['baseline','current']){
    const report=JSON.parse(fs.readFileSync(`tests/fixtures/golden/method-lines/${side}.json`,'utf8'));
    const current=side==='current',d=report.detail_metrics,s=report.summary_metrics;
    d.file_sizes={
      [root+'/src/unknown.c']:[100,120,current?null:10],
      [root+'/src/unknown.h']:[current?null:20,30,0],
      [root+'/src/zero.c']:[0,0,0],
      [root+'/src/known.c']:[current?150:100,180,0],
      [root+'/src/limited/a.c']:[5,6,0],
      [root+'/src/valid/a.c']:[5,6,0],
    };
    if(current){d.file_sizes[root+'/src/limited/b.c']=[5,6,0];d.file_sizes[root+'/src/valid/b.c']=[5,6,0];}
    const method=(name,loc,cc,line)=>({file_name:root+'/src/known.c',method_name:name,start_line:line,end_line:line+20,nbnc_loc:loc,cyclomatic_complexity:cc});
    d.method_metrics=[method('unknown-lines',current?null:20,5,1),method('unknown-cc',5,current?null:20,30),method('zero',0,0,60),method('known',current?11:10,current?11:10,90),{maximum_nbnc_loc:20,maximum_cyclomatic_complexity:20}];
    if(current)d.method_metrics.splice(1,0,method('unknown-lines',2,5,25));
    d.code_duplication={};d.file_duplication={};d.unsafe_functions={};d.redundant_code={};
    d.huge_folders=current?{[root+'/src/limited']:3,[root+'/src/valid']:2}:{};
    s.huge_threshold={huge_headerfile:10,huge_non_headerfile:100,huge_method:current?9:10,huge_cyclomatic_complexity:10,huge_folder:1};
    s.files_total=Object.keys(d.file_sizes).length;s.methods_total=d.method_metrics.length-1;
    if(current&&comparison){s.cmetrics_version+='-different';s.command='cmetrics -fp /unconfirmed/root -l clike';}
    const content=JSON.stringify(report,null,2);fs.writeFileSync(path.join(output,side+'.json'),content);
    inputHashes[side]=crypto.createHash('sha256').update(content).digest('hex');
  }
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({root,config:{seed:1},unionFiles:8}));
  let build;
  try{
    build=execFileSync('uv',['run','python','-m','prototypes.ui.prototype','--input-dir',output,'--output-dir',output],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  }catch(error){
    fs.writeFileSync(path.join(output,'build-failure.txt'),String(error.stderr||error));
    throw new Error('真实异常 JSON 构建失败：'+String(error.stderr||error));
  }
  fs.writeFileSync(path.join(output,'build.log'),build);
  const html=fs.readFileSync(path.join(output,'cmetrics-prototype.html'),'utf8');
  // 独立读取二进制头与有效位，不借用 Worker 的解释函数，防止两端同时误解协议。
  const binary=kind=>{
    const b64=html.match(new RegExp(`data-block-kind="${kind}">([^<]+)`))[1];
    const bytes=zlib.gunzipSync(Buffer.from(b64,'base64')),length=bytes.readUInt32LE(0),header=JSON.parse(bytes.subarray(4,4+length)),start=(4+length+3)&~3;
    return Object.fromEntries(Object.entries(header.a).map(([name,col])=>[name,Array.from({length:col.n},(_,i)=>col.t==='u8'?bytes[start+col.o+i]:bytes.readUInt32LE(start+col.o+i*4))]));
  };
  const blockText=kind=>zlib.gunzipSync(Buffer.from(html.match(new RegExp(`data-block-kind="${kind}">([^<]+)`))[1],'base64')).toString();
  const meta=JSON.parse(blockText('meta')),dirs=JSON.parse(blockText('dirs'));
  const decodeDictionary=kind=>meta.dictionaryEncoding==='json'?JSON.parse(blockText(kind)):blockText(kind).split('\n');
  const paths=decodeDictionary('paths'),names=decodeDictionary('names'),files=binary('files'),methods=binary('methodsC');
  const {send,source}=await loadWorker(html,'report-worker');
  const state={view:'workspace',scenario:'normal',type:'code',metric:'code_size',directory:'',query:'',exactFile:null,searchScope:'all',status:'all',sort:'path:asc',numberFilter:null,page:1,pageSize:50,selected:null,directoryPage:1,chartPage:1,overviewChanges:['growth','decrease']};
  let checks=0;const snapshots={};
  const eq=(actual,expected,message)=>{assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,message);checks++;};
  const read=async(type,patch={})=>{const result=await send({op:'snapshot',state:{...state,type,...patch}});snapshots[type+':'+JSON.stringify(patch)]=result;return result;};
  const unknown=(row,label)=>{assert(row,label+' 必须保留异常对象');checks++;eq(row.c,null,label+' 当前未知');eq(row.delta,null,label+' 差值未知');assert(row.flags.includes('unknown'),label+' unknown 标记');checks++;};
  for(const key of ['code_size','lines_per_file','code_duplication_ratio','non_hfile_code_duplication_ratio','lines_per_method','cyclomatic_complexity_per_method','huge_method_total','huge_method_ratio','huge_cyclomatic_complexity_total','huge_cyclomatic_complexity_ratio','huge_folder_total','huge_folder_ratio']){
    assert(meta.integrity.summaryIssues[key]?.some(reason=>reason.includes('未知')||reason.includes('覆盖')),key+' 必须携带实际未知或覆盖原因');checks++;
  }
  eq(meta.integrity.comparisonIssues.some(reason=>reason.includes('cmetrics_version')),comparison,'扫描工具版本差异');
  eq(meta.integrity.comparisonIssues.some(reason=>reason.includes('路径映射')),comparison,'command 根与 manifest 根映射限制');
  for(const directory of ['', 'src']){
    eq(dirs.find(d=>d.p===directory).cC,null,'未知代码行向目录祖先传播');
  }
  eq(dirs.find(d=>d.p==='src/limited').cC,10,'无未知的子目录继续保留有效聚合');
  eq(files.cValid[paths.indexOf('src/unknown.c')],3,'重复行未知清 bit 4');
  eq(files.cValid[paths.indexOf('src/unknown.h')],6,'代码行未知清 bit 1');
  eq(files.cValid[paths.indexOf('src/zero.c')],7,'真实零仍有效');
  eq(files.cD[paths.indexOf('src/unknown.c')],0,'物理占位值只由有效位解释');
  eq(methods.valid[methods.na.indexOf(names.indexOf('unknown-lines'))],2,'函数代码行 bit 1');
  eq(methods.valid[methods.na.indexOf(names.indexOf('unknown-cc'))],1,'函数圈复杂度 bit 2');
  const duplication=await read('duplication',{selected:'file:src/unknown.c'});
  unknown(duplication.query.rows.find(r=>r.path==='src/unknown.c'),'重复行');
  eq(duplication.query.aggregate.current.value,null,'范围合计保留未知');
  const code=await read('code');unknown(code.query.rows.find(r=>r.path==='src/unknown.h'),'文件代码行');
  const zero=code.query.rows.find(r=>r.path==='src/zero.c');eq([zero.b,zero.c,zero.delta],[0,0,0],'真实零保持业务零');
  for(const [type,name,field] of [['methodLines','unknown-lines','nbnc_loc'],['cc','unknown-cc','cyclomatic_complexity']]){
    const snapshot=await read(type),row=snapshot.query.rows.find(r=>r.name===name);unknown(row,name);
    eq(row.after[0][field],null,'函数原始证据保留未知');
    eq(snapshot.query.aggregate.current.value,null,'函数范围合计保留未知');
  }
  const transitions=(await read('hugeMethod')).transitions;
  for(const [type,entered,limited] of [['hugeHeader',0,true],['hugeSource',1,false],['hugeMethod',1,true],['hugeCC',1,true],['folders',1,true]]){
    eq({entered:transitions[type].entered,exited:transitions[type].exited,limited:transitions[type].limited},{entered,exited:0,limited:comparison||limited},type+' 全局进出限制');
    const all=await read(type);
    for(const row of all.query.rows.filter(r=>r.flags.includes('unknown')||r.flags.includes('incomparable'))){
      eq(row.transitionKnown,false,type+' 异常进出不可确定');
      assert(!row.flags.includes('entered')&&!row.flags.includes('exited'),type+' 不得给出虚假进出');checks++;
    }
    for(const status of ['entered','exited']){
      const filtered=await read(type,{status});
      eq(filtered.query.total,status==='entered'&&!comparison?entered:0,type+' 真实 Worker 进出筛选');
    }
  }
  const folder=await read('folders',{selected:'folder:src/limited'});
  const limited=folder.query.rows.find(r=>r.path==='src/limited');
  eq([limited.declaredAfter,limited.recoveredAfter],[3,2],'目录覆盖冲突原值');
  eq(folder.evidence.coverage.current,{declared:3,recovered:2,limited:true},'独立目录证据限制');
  const combined=(await read('hugeMethod')).query.rows.find(r=>r.name==='unknown-lines');
  assert(combined.flags.includes('ambiguous')&&combined.flags.includes('unknown'),'组合原因必须并存');checks++;
  assert(combined.warning.includes('同名函数')&&combined.warning.includes('阈值变化'),'组合提示必须并存');checks++;
  const overview=(await read('code')).overview;
  assert(!Object.values(overview.files).slice(0,3).some(group=>group.rows.some(r=>r.path==='src/unknown.h')),'概览方向不能把未知当零');checks++;
  const proof={checks,failed:0,inputHashes,workerSha256:crypto.createHash('sha256').update(source).digest('hex'),htmlSha256:crypto.createHash('sha256').update(html).digest('hex'),binary:{paths,names,files,methods,dirs},integrity:meta.integrity,transitions,snapshots,scope:'真实落盘 JSON 经 Python build 到产物内 Worker；Node VM 不代表浏览器验收'};
  fs.writeFileSync(path.join(output,'compact-anomalies-evidence.json'),JSON.stringify(proof,null,2));
  console.log(JSON.stringify({checks,failed:0,output,evidence:path.join(output,'compact-anomalies-evidence.json'),inputHashes,workerSha256:proof.workerSha256},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
