/* U03/A02：当前度量未变，位置及其他度量变化的原始证据仍可达。 */
(async()=>{
  let checks=0;
  const check=(ok,message)=>{checks++;if(!ok)throw new Error(message);};
  const state=()=>JSON.parse(document.querySelector('.state-inspector pre').textContent);
  const wait=async()=>{const end=performance.now()+15000;while(document.documentElement.dataset.queryState==='loading'){if(performance.now()>end)throw new Error('超时');await new Promise(requestAnimationFrame);}check(document.documentElement.dataset.queryState==='ready','查询就绪');};
  const click=async selector=>{document.querySelector(selector).click();await wait();};
  await wait();await click('[data-action="view"][data-value="workspace"]');
  await click('[data-action="analysis-type"][data-value="lines_per_method"]');
  await click('[data-action="status"][data-value="unchanged"]');
  const input=document.querySelector('#query-form [name="query"]');input.value='moved';input.dispatchEvent(new Event('input',{bubbles:true}));await wait();
  check(state().result===1,'名称查询在无变化中唯一匹配');
  check(document.querySelector('.data-table tbody tr').textContent.includes('无变化'),'当前代码行度量无变化');
  const sections=[...document.querySelectorAll('.evidence-section')].map(n=>n.textContent);
  check(sections.some(t=>t.includes('基线')&&t.includes('L50–68')&&t.includes('代码行 18')&&t.includes('圈复杂度 3')),'基线原始位置与另一度量');
  check(sections.some(t=>t.includes('当前')&&t.includes('L250–268')&&t.includes('代码行 18')&&t.includes('圈复杂度 9')),'当前移动位置与另一度量');
  await click('[data-action="status"][data-value="changes"]');
  check(state().result===0,'位置或另一度量变化不混入当前度量变化');
  await click('[data-action="status"][data-value="unchanged"]');
  check(state().result===1&&document.querySelector('.evidence-panel').textContent.includes('L250–268'),'返回无变化后证据可达');
  return {result:'passed',checks};
})();
