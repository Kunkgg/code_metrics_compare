/* 浏览器证据专项：独立小夹具的分页、选组、精确跳转与返回。 */
(async()=>{
  let checks=0;
  const assert=(condition,message)=>{checks++;if(!condition)throw new Error(message);};
  const state=()=>JSON.parse(document.querySelector('.state-inspector pre').textContent);
  const settle=async()=>{const start=performance.now();while(document.documentElement.dataset.queryState==='loading'){if(performance.now()-start>15000)throw new Error('超时');await new Promise(requestAnimationFrame);}assert(document.documentElement.dataset.queryState==='ready','查询失败');await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  const click=async selector=>{const node=document.querySelector(selector);assert(!!node,'缺少控件：'+selector);node.click();await settle();};
  await settle();await click('[data-action="view"][data-value="workspace"]');await click('[data-action="analysis-type"][data-value="code_duplication_ratio"]');
  assert(state().selected==='file:src/anchor.c','没有选中anchor');
  assert(document.querySelectorAll('[data-action="group"][data-side="baseline"]').length===12,'组列表没有分页');
  await click('[data-action="evidence-page"][data-key="groups-baseline"][data-value="1"]');
  const currentGroup=state().groups.current;
  const group=document.querySelector('[data-action="group"][data-side="baseline"]');const target=group.dataset.value;group.click();await settle();
  assert(state().groups.baseline===target&&state().groups.current===currentGroup,'两侧选组相互污染');
  await click('[data-action="evidence-page"][data-key="fragments-baseline"][data-value="1"]');
  assert(document.querySelectorAll('.group-side:first-child .fragment').length===12,'片段没有分页');
  const saved=state(),peer=document.querySelector('.peer-table [data-action="evidence-open"]'),peerPath=peer.dataset.value;
  assert(peer.closest('tr').lastElementChild.textContent==='0','夹具关联文件应未增长');peer.click();await settle();
  assert(state().exactFile===peerPath&&state().result===1,'关联文件未精确定位');
  await click('.table-panel [data-action="back"]');
  assert(JSON.stringify(state().groups)===JSON.stringify(saved.groups)&&JSON.stringify(state().evidenceControls)===JSON.stringify(saved.evidenceControls),'返回丢失选组或分页');
  assert(document.querySelectorAll('.peer-table [data-action="evidence-open"]').length<=12,'关联文件DOM无界');
  await click('[data-action="analysis-type"][data-value="huge_folder_total"]');await click('[data-action="status"][data-value="all"]');
  await click('[data-action="select"][data-value="folder:src"]');await click('[data-action="member-filter"][data-value="all"]');
  assert(document.querySelector('.evidence-panel').textContent.includes('扫描申报数')&&document.querySelector('.evidence-panel').textContent.includes('恢复成员数'),'未分开显示目录口径');
  assert(document.querySelectorAll('[data-action="member-open"]').length===12,'目录成员没有分页');
  await click('[data-action="member-page"][data-value="1"]');assert(state().memberPage===2,'目录成员翻页失败');
  return {result:'passed',checks};
})();
