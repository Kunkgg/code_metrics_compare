/* 一次性小数据检查：生成临时输入并执行产物中的真实 Worker，不修改 golden。 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {loadWorker}=require('./worker-harness.cjs');
(async()=>{
  const output=path.resolve(process.argv[2]||'output/unified-prototype/evidence-small');fs.mkdirSync(output,{recursive:true});
  const root='/golden/project',anchor='src/anchor.c',paths=[anchor,...Array.from({length:31},(_,i)=>`src/peer-${String(i).padStart(2,'0')}.c`),'src/anchor.c.more',...Array.from({length:14},(_,i)=>`src/sub-${i}/child.c`)];
  for(const side of ['baseline','current']){
    const report=JSON.parse(fs.readFileSync('tests/fixtures/golden/code-duplication/'+side+'.json','utf8')),d=report.detail_metrics,s=report.summary_metrics;
    d.file_sizes=Object.fromEntries(paths.map(p=>[root+'/'+p,[100,120,p===anchor&&side==='current'?50:10]]));
    d.method_metrics=[{maximum_cyclomatic_complexity:0,maximum_nbnc_loc:0}];d.code_duplication={};d.file_duplication={};d.unsafe_functions={};d.redundant_code={};
    // 数字外观但非索引的原 ID；两侧故意使用不同 ID 和插入顺序。
    for(let g=0;g<27;g++){
      const id=`${side==='baseline'?'B':'C'}-original-${100+g*7}`;
      d.code_duplication[id]=[anchor,...paths.slice(1,32)].map((p,i)=>({file_name:root+'/'+p,start_line:1+g*100+i,code_duplication:1}));
      d.file_duplication['whole-'+id]=[anchor,...paths.slice(1,32)].map(p=>root+'/'+p);
    }
    d.huge_folders={[root+'/src']:side==='baseline'?47:52};if(side==='current')d.huge_folders[root+'/src/sub-13']=1;
    s.files_total=paths.length;s.code_size=paths.length*100;s.raw_lines=paths.length*120;s.methods_total=0;s.method_lines=0;s.cyclomatic_complexity_total=0;s.code_duplication_total=paths.length*10+(side==='current'?40:0);s.huge_folder_total=1;s.huge_threshold.huge_folder=1;
    fs.writeFileSync(path.join(output,side+'.json'),JSON.stringify(report));
  }
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({root,config:{seed:1},unionFiles:paths.length}));
  execFileSync('uv',['run','python','-m','prototypes.ui.prototype','--input-dir',output,'--output-dir',output],{stdio:'pipe'});
  const {send}=await loadWorker(fs.readFileSync(path.join(output,'cmetrics-prototype.html'),'utf8'),'report-worker');
  const base={view:'workspace',scenario:'normal',type:'duplication',metric:'code_duplication_ratio',directory:'',query:'',status:'all',sort:'path:asc',page:1,pageSize:10,selected:'file:'+anchor,exactFile:anchor,searchScope:'all',directoryPage:1,chartPage:1,overviewChanges:['growth','decrease'],groups:{baseline:null,current:null},memberStatus:'all',memberPage:1};
  const read=async patch=>(await send({op:'snapshot',state:{...base,...patch}}));let checks=0;
  const eq=(actual,expected)=>{assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)));checks++;};
  const initial=await read({});assert(initial.evidence,'snapshot 必须接入 evidence');
  eq(initial.evidence.sides.baseline.active,'B-original-100');eq(initial.evidence.sides.current.active,'C-original-100');
  for(const type of ['duplication','sourceDuplication','dupfiles','sourceDupfiles']){
    const whole=type.includes('upfiles'),prefix=whole?'whole-':'';
    const selectedGroups={baseline:prefix+'B-original-282',current:prefix+'C-original-191'};
    const independent=await read({type,groups:selectedGroups});eq(independent.evidence.sides.baseline.active,selectedGroups.baseline);eq(independent.evidence.sides.current.active,selectedGroups.current);
    for(const side of ['baseline','current']){
      const allGroups=[],allMembers=[];
      for(let page=1;page<=3;page++){
        const snap=await read({type,groups:selectedGroups,evidenceControls:{['groups-'+side]:{page},['fragments-'+side]:{page}}});
        const data=snap.evidence.sides[side];assert(data.groups.rows.length<=12&&data.members.rows.length<=12);checks++;
        allGroups.push(...data.groups.rows.map(g=>g.id));allMembers.push(...data.members.rows.map(m=>m.path));
      }
      eq(allGroups,Array.from({length:27},(_,i)=>prefix+`${side==='baseline'?'B':'C'}-original-${100+i*7}`));eq(allMembers,[anchor,...paths.slice(1,32)]);
      const filtered=await read({type,evidenceControls:{['groups-'+side]:{query:'282',page:100},['fragments-'+side]:{query:'peer-30',page:100}}});
      eq(filtered.evidence.sides[side].groups.rows.map(g=>g.id),[prefix+`${side==='baseline'?'B':'C'}-original-282`]);eq(filtered.evidence.sides[side].members.rows.map(m=>m.path),['src/peer-30.c']);
    }
    const peers=[];for(let page=1;page<=3;page++){const snap=await read({type,evidenceControls:{peers:{page}}});peers.push(...snap.evidence.peers.rows.map(m=>m.path));eq(snap.evidence.peers.total,31);}
    eq(peers,paths.slice(1,32));const filtered=await read({type,evidenceControls:{peers:{query:'peer-30',page:100}}});eq(filtered.evidence.peers.rows.map(m=>m.path),['src/peer-30.c']);
  }
  const exact=await read({type:'duplication',exactFile:anchor,query:anchor});eq(exact.query.rows.map(r=>r.path),[anchor]);
  const folderPatch={type:'folders',metric:'huge_folder_total',exactFile:null,selected:'folder:src'};
  const folder=await read(folderPatch);eq(folder.evidence.members.totalMembers,47);eq(folder.evidence.coverage.baseline,{declared:47,recovered:47,limited:false});eq(folder.evidence.coverage.current,{declared:52,recovered:47,limited:true});
  const members=[];for(let memberPage=1;memberPage<=4;memberPage++){const snap=await read({...folderPatch,memberPage});assert(snap.evidence.members.rows.length<=12);members.push(...snap.evidence.members.rows.map(m=>m.path));}
  eq(members.length,47);eq(new Set(members).size,47);eq(members.filter(p=>p.endsWith('/child.c')),[]);
  const directorySearch=await read({...folderPatch,memberQuery:'sub-13',memberPage:100});eq(directorySearch.evidence.members.rows.map(m=>m.path),['src/sub-13']);
  const unchanged=await read({...folderPatch,memberStatus:'changes'});eq(unchanged.evidence.members.total,0);
  const undeclared=await read({...folderPatch,selected:'folder:src/sub-13'});eq(undeclared.evidence.coverage.baseline,{declared:null,recovered:1,limited:true});eq(undeclared.evidence.coverage.current,{declared:1,recovered:1,limited:false});
  const unknown=await read({scenario:'limited',exactFile:'src/peer-00.c',selected:'file:src/peer-00.c'});const unknownPeer=unknown.evidence.peers.rows.find(r=>r.path===anchor);eq(unknownPeer.c,null);eq(unknownPeer.delta,null);
  console.log(JSON.stringify({checks,failed:0,output},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
