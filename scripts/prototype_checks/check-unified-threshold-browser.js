/* 批准的阈值变化夹具：五类三页及静态，按独立预期检查观测值和清单进出。 */
(async()=>{
  const expected=window.__thresholdExpected;let checks=0;
  const check=(ok,message)=>{checks++;if(!ok)throw new Error(message);};
  const wait=async()=>{const deadline=performance.now()+15000;while(document.documentElement.dataset.queryState==='loading'){if(performance.now()>deadline)throw new Error('超时');await new Promise(requestAnimationFrame);}check(document.documentElement.dataset.queryState==='ready','查询就绪');};
  const click=async selector=>{const node=document.querySelector(selector);check(!!node,selector);node.click();await wait();};
  const types={hugeHeader:'huge_headerfile',hugeSource:'huge_non_headerfile',hugeMethod:'huge_method',hugeCC:'huge_cyclomatic_complexity',folders:'huge_folder'};
  const number=value=>Number(value.replaceAll(',','').replace('%','').replace('个百分点','').trim());
  await wait();await click('[data-action="view"][data-value="metrics"]');
  for(const [key,value] of Object.entries(expected.summary_comparison)){
    const row=document.querySelector(`[data-summary-metric="${key}"]`),cells=[...row.children].slice(1);
    check(JSON.stringify(cells.map(c=>number(c.textContent)))===JSON.stringify([value.b,value.c,value.delta]),key+' 全部指标值');
    check(row.textContent.includes('阈值变化'),key+' 全部指标提示');
    const stat=document.querySelector(`[data-static-metric="${key}"]`);
    check(JSON.stringify([...stat.children].slice(1,4).map(c=>number(c.textContent)))===JSON.stringify([value.b,value.c,value.delta]),key+' 静态值');
    check(stat.textContent.includes('不证明代码恶化或改善'),key+' 静态提示');
  }
  for(const [type,prefix] of Object.entries(types)){
    const key=prefix+'_total';
    for(const status of ['entered','exited']){
      const wanted=expected.queries.find(q=>q.state.type===type&&q.state.status===status)?.rows.length;
      check(wanted!==undefined,type+' 有独立预期 '+status);
      const transition=document.querySelector(`[data-huge-type="${type}"] [data-status="${status}"]`);
      check(number(transition.querySelector('b').textContent)===wanted,type+' 全部指标进出 '+status);
      transition.click();await wait();
      const state=JSON.parse(document.querySelector('.state-inspector pre').textContent);
      check(state.type===type&&state.status===status&&state.result===wanted,type+' 进出入口下钻 '+status);
      check(document.querySelector('.threshold-note').textContent.includes('不证明代码恶化或改善'),type+' 分析阈值提示');
      await click('[data-action="view"][data-value="metrics"]');
    }
    await click('[data-action="view"][data-value="workspace"]');
    await click(`[data-action="analysis-type"][data-value="${prefix}_ratio"]`);
    check(document.querySelector('.impact-unavailable').textContent.includes('超限阈值变化'),type+' 净影响限制');
    check(!document.querySelector('[data-action="contributor"]'),type+' 不输出排名');
    await click('[data-action="view"][data-value="overview"]');
    const card=document.querySelector(`[data-overview-metric="${key}"]`);
    check(card.textContent.includes('阈值变化')&&card.textContent.includes('不证明代码恶化或改善'),type+' 概览提示');
    const vals=[...card.querySelectorAll('.metric-bottom b')].map(n=>number(n.textContent)),v=expected.summary_comparison[key];
    check(JSON.stringify(vals)===JSON.stringify([v.b,v.c]),type+' 概览两侧值');
    await click('[data-action="view"][data-value="metrics"]');
  }
  return {result:'passed',checks};
})();
