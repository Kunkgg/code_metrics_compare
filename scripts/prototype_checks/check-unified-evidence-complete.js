/* 在 agent-browser evidence-complete session 执行；保存每页实际 DOM 与返回状态。 */
(async()=>{
  const checks=[],pages=[],failures=[];
  const state=()=>JSON.parse(document.querySelector('.state-inspector pre').textContent);
  const check=(name,expected,actual)=>{const pass=JSON.stringify(expected)===JSON.stringify(actual);checks.push({name,pass,expected,actual});};
  const settle=async()=>{const start=performance.now();while(document.documentElement.dataset.queryState==='loading'){if(performance.now()-start>20000)throw new Error('查询超时');await new Promise(requestAnimationFrame);}if(document.documentElement.dataset.queryState!=='ready')throw new Error('查询失败');await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  const click=async selector=>{const node=document.querySelector(selector);if(!node)throw new Error('缺少控件 '+selector);if(node.disabled)throw new Error('控件禁用 '+selector);node.click();await settle();};
  const change=async(selector,value)=>{const node=document.querySelector(selector);if(!node)throw new Error('缺少输入 '+selector);node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));await settle();};
  const reset=async metric=>{await click('[data-action="analysis-type"][data-value="'+metric+'"]');await click('[data-action="status"][data-value="all"]');};
  const compareState=s=>Object.fromEntries(['metric','type','directory','query','status','sort','page','selected','exactFile','groups','evidenceControls','memberPage','memberQuery','memberStatus','methodPages'].map(k=>[k,s[k]]));
  const roundtrip=async(selector,label,targetType)=>{const saved=state(),node=document.querySelector(selector);if(!node)throw new Error('下钻目标缺失 '+selector);const target=node.dataset.value,kind=node.dataset.kind;await click(selector);if(kind==='目录')check(label+'.directory',target,state().directory);else check(label+'.exactFile',target,state().exactFile);if(targetType)check(label+'.type',targetType,state().type);await click('.table-panel [data-action="back"]');check(label+'.return',compareState(saved),compareState(state()));};
  const run=async(name,fn)=>{try{await fn();}catch(error){failures.push({name,error:String(error),state:state(),dom:document.querySelector('.evidence-panel')?.innerText});}};
  await settle();await click('[data-action="view"][data-value="workspace"]');
  const members=['src/anchor.c',...Array.from({length:31},(_,i)=>'src/peer-'+String(i).padStart(2,'0')+'.c'),'src/zz-header.h'];
  for(const [type,metric] of [['duplication','code_duplication_ratio'],['sourceDuplication','non_hfile_code_duplication_ratio'],['dupfiles','file_duplication_ratio'],['sourceDupfiles','non_hfile_duplication_ratio']])await run(type,async()=>{
    await reset(metric);await click('[data-action="select"][data-value="file:src/anchor.c"]');
    const whole=type==='dupfiles'||type==='sourceDupfiles';
    for(const [side,index] of [['baseline',1],['current',2]]){
      const expected=Array.from({length:27},(_,g)=>(whole?'whole-':'')+(side==='baseline'?'B':'C')+'-original-'+(100+g*7));
      const groups=[];
      for(let page=1;page<=3;page++){
        await change('[data-change="evidencePage"][data-key="groups-'+side+'"]',page);
        const actual=[...document.querySelectorAll('[data-action="group"][data-side="'+side+'"]')].map(n=>n.dataset.value);groups.push(...actual);pages.push({type,key:'groups-'+side,page,actual});
        check(type+'.'+side+'.groups.page'+page,expected.slice((page-1)*12,page*12),actual);
      }
      check(type+'.'+side+'.all-groups',expected,groups);
      await change('[data-change="evidenceQuery"][data-key="groups-'+side+'"]','282');
      check(type+'.'+side+'.group-search',[expected[26]],[...document.querySelectorAll('[data-action="group"][data-side="'+side+'"]')].map(n=>n.dataset.value));
      const other=state().groups[side==='baseline'?'current':'baseline'];await click('[data-action="group"][data-side="'+side+'"]');
      check(type+'.'+side+'.independent-group',other,state().groups[side==='baseline'?'current':'baseline']);
      await change('[data-change="evidenceQuery"][data-key="groups-'+side+'"]','');
      const all=[];
      for(let page=1;page<=3;page++){
        await change('[data-change="evidencePage"][data-key="fragments-'+side+'"]',page);
        const selector='.group-side:nth-child('+index+') .fragment [data-action="evidence-open"]';
        const actual=[...document.querySelectorAll(selector)].map(n=>n.dataset.value);all.push(...actual);pages.push({type,key:'fragments-'+side,page,actual,dom:document.querySelector('.group-side:nth-child('+index+') .fragment-list').innerText});
        check(type+'.'+side+'.members.page'+page,members.slice((page-1)*12,page*12),actual);
        if(!whole){const lines=[...document.querySelectorAll('.group-side:nth-child('+index+') .fragment-values span:first-child b')].map(n=>Number(n.textContent.replaceAll(',','')));check(type+'.'+side+'.fragment-lines.page'+page,members.slice((page-1)*12,page*12).map((p,i)=>p.endsWith('.h')?9000:2601+(page-1)*12+i),lines);}
      }
      check(type+'.'+side+'.all-members',members,all);
      await roundtrip('.group-side:nth-child('+index+') .fragment [data-action="evidence-open"]',type+'.'+side+'.member-drill',type);
      await change('[data-change="evidenceQuery"][data-key="fragments-'+side+'"]','peer-30');
      check(type+'.'+side+'.member-search',['src/peer-30.c'],[...document.querySelectorAll('.group-side:nth-child('+index+') .fragment [data-action="evidence-open"]')].map(n=>n.dataset.value));
      await roundtrip('.group-side:nth-child('+index+') .fragment [data-action="evidence-open"]',type+'.'+side+'.search-drill',type);
      await change('[data-change="evidenceQuery"][data-key="fragments-'+side+'"]','');
    }
    const peers=[];
    for(let page=1;page<=3;page++){
      await change('[data-change="evidencePage"][data-key="peers"]',page);
      const actual=[...document.querySelectorAll('.peer-table [data-action="evidence-open"]')].map(n=>n.dataset.value);peers.push(...actual);pages.push({type,key:'peers',page,actual});check(type+'.peers.page'+page,members.slice(1).slice((page-1)*12,page*12),actual);
    }
    check(type+'.all-peers',members.slice(1),peers);
    await change('[data-change="evidenceQuery"][data-key="peers"]','peer-30');
    check(type+'.peers.search',['src/peer-30.c'],[...document.querySelectorAll('.peer-table [data-action="evidence-open"]')].map(n=>n.dataset.value));
    await roundtrip('.peer-table [data-action="evidence-open"]',type+'.peer-search-return',type);
    await change('[data-change="evidenceQuery"][data-key="peers"]','zz-header');
    await roundtrip('.peer-table [data-action="evidence-open"]',type+'.header-return',whole?'dupfiles':'duplication');
  });
  await run('folders',async()=>{
    await reset('huge_folder_total');await click('[data-action="select"][data-value="folder:src"]');await click('[data-action="member-filter"][data-value="all"]');
    const expected=[...members,'src/anchor.c.more',...Array.from({length:14},(_,i)=>'src/sub-'+i)].sort(),actual=[];
    for(let page=1;page<=4;page++){
      await change('[data-change="memberPage"]',page);const rows=[...document.querySelectorAll('[data-action="member-open"]')].map(n=>({path:n.dataset.value,kind:n.dataset.kind}));pages.push({key:'directory-members',page,actual:rows});actual.push(...rows.map(n=>n.path));check('folders.page'+page,expected.slice((page-1)*12,page*12),rows.map(n=>n.path));
    }
    check('folders.all-members',expected,actual);
    for(const [query,kind] of [['peer-30','文件'],['sub-13','目录']]){
      await change('[data-change="memberQuery"]',query);check('folders.search.'+kind,[query==='peer-30'?'src/peer-30.c':'src/sub-13'],[...document.querySelectorAll('[data-action="member-open"]')].map(n=>n.dataset.value));await roundtrip('[data-action="member-open"]','folders.'+kind+'.return','code');
    }
  });
  for(const metric of ['cyclomatic_complexity_per_method','lines_per_method'])await run('records.'+metric,async()=>{
    await reset(metric);
    const original=state().methodPages;
    for(const [side,label,count] of [['baseline','基线',45],['current','当前',47]]){
      const actual=[];
      for(let page=1;page<=3;page++){
        const other=state().methodPages[side==='baseline'?'current':'baseline'];
        await change('[data-change="methodPage"][data-side="'+side+'"]',page);
        const section=[...document.querySelectorAll('.evidence-section')].find(n=>n.querySelector('h3')?.textContent.startsWith(label+' /'));
        const rows=[...section.querySelectorAll('.raw-row')].map(n=>n.innerText);actual.push(...rows);pages.push({key:'records',metric,side,page,actual:rows});
        check(metric+'.'+side+'.page'+page,Math.min(20,count-(page-1)*20),rows.length);
        check(metric+'.'+side+'.independent'+page,other,state().methodPages[side==='baseline'?'current':'baseline']);
        const starts=rows.map(t=>Number(t.match(/L(\d+)–/)[1]));check(metric+'.'+side+'.positions'+page,Array.from({length:rows.length},(_,i)=>10+((page-1)*20+i)*10),starts);
      }
      check(metric+'.'+side+'.total',count,actual.length);check(metric+'.'+side+'.unique',count,new Set(actual).size);
    }
    check(metric+'.ambiguous',true,document.querySelector('.evidence-panel').textContent.includes('不计算逐函数变化'));
  });
  return {result:failures.length||checks.some(c=>!c.pass)?'failed':'passed',checks:checks.length,failed:checks.filter(c=>!c.pass).length+failures.length,failures,results:checks,pages,userAgent:navigator.userAgent};
})();
