/* 真实浏览器回归：等待异步结果，覆盖完整文件任务与过期响应。 */
(async()=>{
  let checks=0;
  const assert=(condition,message)=>{checks++;if(!condition)throw new Error(message);};
  const state=()=>JSON.parse(document.querySelector('.state-inspector pre').textContent);
  const settle=async()=>{
    const started=performance.now();
    while(document.documentElement.dataset.queryState==='loading'){
      if(performance.now()-started>15000)throw new Error('查询未在15秒内完成');
      await new Promise(requestAnimationFrame);
    }
    if(document.documentElement.dataset.queryState!=='ready')throw new Error(document.querySelector('#query-notice')?.textContent||'查询不可用');
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  };
  const click=async selector=>{const element=document.querySelector(selector);assert(!!element,'缺少控件：'+selector);element.click();await settle();};
  const rowCount=()=>document.querySelectorAll('.data-table [data-action="select"]').length;
  const metadata=JSON.parse(document.querySelector('#report-data').textContent).meta;
  await settle();
  await click('[data-action="view"][data-value="workspace"]');
  await click('[data-action="status"][data-value="all"]');
  await click('[data-action="sort"][data-value="path"]');
  assert(state().result===metadata.unionFiles,'完整文件总数错误');
  assert(rowCount()===Math.min(10,metadata.unionFiles),'首页数量错误');
  const pages=Math.ceil(metadata.unionFiles/10);
  if(pages>=51){
    const input=document.querySelector('.table-panel .page-jump');input.value='51';input.dispatchEvent(new Event('change',{bubbles:true}));await settle();
    assert(state().page===51&&rowCount()===10,'第51页缺失');
  }
  await click(`.table-panel [data-action="page-to"][data-value="${pages}"]`);
  assert(state().page===pages&&rowCount()===metadata.unionFiles-(pages-1)*10,'末页缺失');
  const before=state(),fields=['view','type','metric','directory','query','exactFile','status','sort','page','selected','numberFilter'];
  await click('.evidence-panel [data-action="related"][data-value="cc"]');
  assert(document.querySelector('.table-panel').textContent.includes('尚未接入'),'未完成类型未明确显示状态');
  assert(state().exactFile===before.selected.slice('file:'.length),'关联下钻没有使用精确文件');
  await click('.table-panel [data-action="back"]');
  assert(fields.every(field=>JSON.stringify(state()[field])===JSON.stringify(before[field])),'返回未恢复原阅读位置');
  const input=document.querySelector('#query-form [name="query"]');input.focus();
  for(const text of ['unit_000','__cmetrics_absent_7fa94__']){input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));}
  await settle();
  assert(state().query==='__cmetrics_absent_7fa94__'&&state().result===0,'旧查询覆盖了新条件');
  assert(state().page===0&&rowCount()===0,'空结果仍显示页或旧行');
  assert([...document.querySelectorAll('.table-panel .pagination button')].every(button=>button.disabled),'空结果翻页未禁用');
  assert(document.activeElement?.name==='query','异步重绘丢失搜索焦点');
  await click('[data-action="clear-search"]');
  assert(state().exactFile===null&&state().result===metadata.unionFiles,'清空未恢复完整范围');
  await click('[data-action="edit-number"]');
  const form=document.querySelector('#number-form');form.elements.value.value='1000000000';form.requestSubmit();await settle();
  assert(state().result===0&&!!state().numberFilter,'数值条件没有生效');
  await click('[data-action="clear-number"]');
  assert(state().result===metadata.unionFiles,'移除数值条件未恢复结果');
  const directory=document.querySelector('.directory-tree [data-action="directory"]');
  if(directory){
    const path=directory.dataset.value;directory.click();await settle();
    assert(state().directory===path,'目录下钻没有切换范围');
    await click('.table-panel [data-action="back"]');
    assert(state().directory===''&&state().result===metadata.unionFiles,'目录返回未恢复范围');
  }
  await click('[data-action="view"][data-value="metrics"]');
  assert(document.querySelectorAll('[data-summary-metric]').length===34,'完整指标数不是34');
  await click('[data-action="view"][data-value="workspace"]');
  assert(rowCount()<=10&&document.querySelectorAll('.directory-tree [data-action="directory"]').length<=50,'DOM没有限制当前页');
  assert(document.documentElement.scrollWidth<=innerWidth+1,'页面存在横向溢出');
  return {result:'passed',checks,width:innerWidth,total:metadata.unionFiles,deepPageChecked:pages>=51,pages};
})();
