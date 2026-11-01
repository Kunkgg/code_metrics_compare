/* 大规模证据DOM热点：期望来自独立raw完整集合核验，同一HTML哈希绑定。 */
(async()=>{
 const cfg=CONFIG,results=[],state=()=>JSON.parse(document.querySelector('.state-inspector pre').textContent);
 const settle=async()=>{const end=performance.now()+30000;while(document.documentElement.dataset.queryState==='loading'){if(performance.now()>end)throw Error('证据查询超时');await new Promise(requestAnimationFrame);}if(document.documentElement.dataset.queryState!=='ready')throw Error('证据查询失败');await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
 const click=async(action,value)=>{const node=[...document.querySelectorAll('[data-action]')].find(n=>n.dataset.action===action&&n.dataset.value===value);if(!node)throw Error('控件缺失 '+action+':'+value);node.click();await settle();};
 const page=async(selector,value)=>{const input=document.querySelector(selector);if(!input)throw Error('缺少分页控件 '+selector);const start=performance.now();input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));await settle();return performance.now()-start;};
 const search=async value=>{const input=document.querySelector('#query-form [name="query"]');if(!input)throw Error('缺少搜索控件');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));await settle();};
 const same=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label+' '+JSON.stringify({actual:a,expected:b}));};
 const deep=t=>Math.ceil(t.total/12)>51;
 await settle();await click('view','workspace');
 const metric={duplication:'code_duplication_ratio',sourceDuplication:'non_hfile_code_duplication_ratio',dupfiles:'file_duplication_ratio',sourceDupfiles:'non_hfile_duplication_ratio'};
 for(const type of Object.keys(metric)){
  const definitions=cfg.tasks.filter(t=>t.type===type&&t.requested===51&&!t.query&&!t.key.startsWith('groups')&&(cfg.smoke||deep(t)));
  if(!definitions.length)throw Error('缺少片段/整文件成员与关联文件深页任务：'+type);
  if(!cfg.smoke)for(const key of ['fragments-baseline','fragments-current','peers'])if(!definitions.some(t=>t.key===key))throw Error('缺少深页覆盖：'+type+':'+key);
  await click('analysis-type',metric[type]);await click('status','all');
  const anchor=definitions[0].anchor;await search(anchor);
  if(state().result!==1||state().selected!=='file:'+anchor)throw Error('关联锚点未精确匹配');
  same(state().groups,definitions[0].groups,'两侧原始组号');
  for(const definition of definitions)for(const requested of [51,1e9]){
   const expected=cfg.tasks.find(t=>t.type===type&&t.key===definition.key&&t.requested===requested&&!t.query),key=definition.key;
   if(!expected)throw Error('缺少独立分页proof');
   const selector='[data-change="evidencePage"][data-key="'+key+'"]';
   await page(selector,1);
   const before=state().evidenceControls[key].page,elapsedMs=await page(selector,requested);
   let ids;
   if(key==='peers')ids=[...document.querySelectorAll('.peer-table [data-action="evidence-open"]')].map(n=>n.dataset.value);
   else{
    const side=key.endsWith('baseline')?0:1,section=document.querySelectorAll('.evidence-panel .group-side')[side];
    ids=[...section.querySelectorAll('.fragment [data-action="evidence-open"]')].map(n=>{
     if(['duplication','sourceDuplication'].includes(type))return n.dataset.value+' '+[...n.closest('.fragment').querySelectorAll('.fragment-values b')].map(b=>b.textContent.replaceAll(',','')).join(' ');
     return n.dataset.value;
    });
   }
   same(ids,expected.actualRows,'完整集合所对应的DOM窗口');
   same(state().evidenceControls[key].page,expected.page||1,'证据页码');
   const changed=before!==state().evidenceControls[key].page;
   if(!cfg.smoke&&!changed)throw Error('证据任务未换页');
   results.push({task:type+':'+key+':'+(requested===51?'deep':'last'),elapsedMs,page:expected.page,total:expected.total,ids,changed,fullCollectionSha256:expected.sha256,valid:true});
  }
 }
 const directories=cfg.tasks.filter(t=>t.type==='folders'&&!t.query&&(!t.memberStatus||t.memberStatus==='all'));
 if(!directories.length)throw Error('缺少目录成员proof');
 const target=directories[0].directory;
 if(!cfg.smoke&&!deep(directories[0]))throw Error('目录成员不足51页');
 await click('analysis-type','huge_folder_total');await click('status','all');await search(target);
 const selected=[...document.querySelectorAll('.data-table [data-action="select"]')].find(n=>n.dataset.value==='folder:'+target);if(!selected)throw Error('超大目录不在当前可选择页：'+target);selected.click();await settle();
 await click('member-filter','all');
 for(const requested of [51,1e9]){
  const expected=directories.find(t=>t.requested===requested);
  await page('[data-change="memberPage"]',1);
  const before=state().memberPage,elapsedMs=await page('[data-change="memberPage"]',requested),ids=[...document.querySelectorAll('[data-action="member-open"]')].map(n=>n.dataset.value);
  same(ids,expected.actualRows.map(row=>row[0]),'目录完整集合对应DOM窗口');
  same(state().memberPage,expected.page,'目录页码');
  const changed=before!==state().memberPage;
  if(!cfg.smoke&&!changed)throw Error('目录任务未换页');
  results.push({task:'folders:members:'+(requested===51?'deep':'last'),elapsedMs,page:expected.page,total:expected.total,ids,changed,fullCollectionSha256:expected.sha256,valid:true});
 }
 const saved=state(),node=document.querySelector('[data-action="member-open"]');
 if(!node)throw Error('缺少可下钻目录成员');
 const path=node.dataset.value,kind=node.dataset.kind;node.click();await settle();
 if(kind==='文件'?(state().exactFile!==path||state().result!==1):state().directory!==path)throw Error('成员下钻未精确定位');
 await click('back',undefined);
 const after=state();same([after.metric,after.selected,after.memberPage,after.memberStatus,after.query],[saved.metric,saved.selected,saved.memberPage,saved.memberStatus,saved.query],'返回恢复大目录页');
 return {result:'passed',batch:cfg.batch,smoke:!!cfg.smoke,tasks:results};
})();
