/* 紧凑入口三页与20项指标浏览器回归；每任务20次，覆盖DOM完成后两帧。 */
(async()=>{
  const checks=[],tasks=[];
  const state=()=>JSON.parse(document.querySelector('.state-inspector pre').textContent);
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw new Error(name);};
  const settle=async()=>{
    const start=performance.now();
    while(document.documentElement.dataset.queryState==='loading'){
      if(performance.now()-start>15000)throw new Error('查询超时');
      await new Promise(requestAnimationFrame);
    }
    check('query-ready',document.documentElement.dataset.queryState==='ready');
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  };
  const click=async selector=>{const node=document.querySelector(selector);if(!node)throw new Error('控件不存在：'+selector);node.click();await settle();};
  await settle();
  await click('[data-action="view"][data-value="metrics"]');
  check('全部34项含最大值',document.querySelectorAll('[data-summary-metric]').length===34);
  check('过程数据默认折叠',!document.querySelector('.metrics-support').open);
  await click('[data-action="view"][data-value="workspace"]');
  const metrics=[...document.querySelectorAll('[data-action="analysis-type"]')].map(node=>node.dataset.value);
  check('20项指标入口',metrics.length===20);
  for(const metric of metrics){
    const samples=[];let coldMs;
    for(let i=0;i<=20;i++){
      const start=performance.now();await click(`[data-action="analysis-type"][data-value="${metric}"]`);const elapsed=performance.now()-start;
      if(!i)coldMs=elapsed;else samples.push(elapsed);
      check(metric+'.state',state().metric===metric);
      check(metric+'.bounded-dom',document.querySelectorAll('.data-table [data-action="select"]').length<=10);
      check(metric+'.available',!document.querySelector('.table-panel').textContent.includes('尚未接入'));
      const ratios=['lines_per_file','lines_per_method','cyclomatic_complexity_per_method',...metrics.filter(key=>key.endsWith('_ratio'))];
      if(ratios.includes(metric)){
        check(metric+'.impact-panel',!!document.querySelector('.average-explanation'));
        check(metric+'.bounded-impact',document.querySelectorAll('[data-action="contributor"]').length<=5);
        check(metric+'.impact-connected',!document.querySelector('.average-explanation').textContent.includes('尚未接入'));
      }
    }
    tasks.push({metric,coldMs,samplesMs:samples,p95Ms:[...samples].sort((a,b)=>a-b)[18]});
  }
  await click('[data-action="analysis-type"][data-value="lines_per_file"]');
  const impactBefore=document.querySelector('.average-explanation').textContent;
  const search=document.querySelector('#query-form [name="query"]');search.value='__absent_impact_scope__';search.dispatchEvent(new Event('input',{bubbles:true}));await settle();
  check('表内筛选不改变完整净影响',document.querySelector('.average-explanation').textContent===impactBefore);
  check('表内筛选结果为空',state().result===0);
  const contribution=document.querySelector('[data-action="contributor"]');
  if(contribution){
    const saved=state(),target=contribution.dataset.value;contribution.click();await settle();
    check('页外贡献精确下钻',state().exactFile===target&&state().result===1);
    await click('.table-panel [data-action="back"]');
    check('贡献返回恢复查询与指标',state().query===saved.query&&state().metric===saved.metric&&state().contributionPage===saved.contributionPage);
  }
  await click('[data-action="view"][data-value="overview"]');
  const setDirections=async wanted=>{
    for(const direction of ['growth','decrease','unchanged']){
      if(state().overviewChanges.includes(direction)!==wanted.includes(direction))await click(`[data-action="overview-toggle"][data-value="${direction}"]`);
    }
  };
  // 空选与全选各验证一次，方向入口名称沿用现有UI。
  for(const wanted of [[],['growth','decrease','unchanged'],['growth','decrease']]){
    await setDirections(wanted);check('overview-directions.'+wanted.join(','),state().overviewChanges.length===wanted.length);
    if(!wanted.length)check('空选择无正常卡片',document.querySelectorAll('.metric-card:not(.has-issue)').length===0);
  }
  check('无横向溢出',document.documentElement.scrollWidth<=innerWidth+1);
  return {result:'passed',checks:checks.length,measurement:'本机Chrome页面事件→DOM完成→两帧；任务首次切换为cold（OS缓存未控制），后20次为hot',userAgent:navigator.userAgent,tasks};
})();
