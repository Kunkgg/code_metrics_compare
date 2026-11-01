/* 紧凑页面的完整概览方向矩阵、净零进出与三页往返。 */
(async()=>{
  let checks=0;
  const assert=(ok,message)=>{checks++;if(!ok)throw new Error(message);};
  const state=()=>JSON.parse(document.querySelector('.state-inspector pre').textContent);
  const wait=async()=>{const deadline=performance.now()+15000;while(document.documentElement.dataset.queryState==='loading'){if(performance.now()>deadline)throw new Error('超时');await new Promise(requestAnimationFrame);}assert(document.documentElement.dataset.queryState==='ready','查询就绪');};
  const click=async selector=>{const node=document.querySelector(selector);assert(!!node,'控件 '+selector);node.click();await wait();};
  await wait();await click('[data-action="view"][data-value="overview"]');
  const directions=['growth','decrease','unchanged'];
  for(const [wanted,count] of [[[],0],[['growth'],18],[['decrease'],10],[['unchanged'],2],[['growth','decrease'],18],[['growth','unchanged'],20],[['decrease','unchanged'],12],[directions,20]]){
    for(const value of directions)if(state().overviewChanges.includes(value)!==wanted.includes(value))await click(`[data-action="overview-toggle"][data-value="${value}"]`);
    assert(document.querySelectorAll('[data-overview-metric]').length===count,'概览方向 '+wanted.join()+' 数量 '+count);
    assert(document.querySelectorAll('.overview-files').length===wanted.length,'文件方向同步');
    if(wanted.length===1&&wanted[0]==='unchanged')assert(!document.querySelector('[data-overview-metric^="huge_"]'),'净零有进出的超限不归无变化');
  }
  const metrics=[...document.querySelectorAll('[data-overview-metric]')].map(n=>n.dataset.overviewMetric);
  assert(metrics.length===20,'全部20指标');
  const rounded=document.querySelector('[data-overview-metric="cyclomatic_complexity_per_method"]');
  assert(rounded.querySelector('.metric-direction').textContent==='增长','显示6.39相等但原始比例增长');
  for(const key of metrics){
    await click(`[data-overview-metric="${key}"] .metric-summary`);
    assert(state().metric===key&&state().view==='workspace','卡片精确指标 '+key);
    await click('[data-action="view"][data-value="overview"]');
    assert(state().overviewChanges.length===3,'返回保留方向');
  }
  for(const key of metrics.filter(k=>k.startsWith('huge_'))){
    for(const status of ['entered','exited']){
      await click(`[data-overview-metric="${key}"] [data-status="${status}"]`);
      assert(state().metric===key&&state().status===status&&state().result===1,key+' 净零分别下钻 '+status);
      await click('[data-action="view"][data-value="overview"]');
    }
  }
  return {result:'passed',checks};
})();
