/* 实际未知/覆盖/歧义输入的三页传播；不使用异常演示开关。 */
(async()=>{
  let checks=0;
  const check=(ok,message)=>{checks++;if(!ok)throw new Error(message);};
  const wait=async()=>{const deadline=performance.now()+15000;while(document.documentElement.dataset.queryState==='loading'){if(performance.now()>deadline)throw new Error('超时');await new Promise(requestAnimationFrame);}check(document.documentElement.dataset.queryState==='ready','就绪');};
  const click=async selector=>{const node=document.querySelector(selector);check(!!node,selector);node.click();await wait();};
  const state=()=>JSON.parse(document.querySelector('.state-inspector pre').textContent);
  await wait();check(state().scenario==='normal','没有演示开关');
  for(const key of ['code_size','lines_per_file','code_duplication_ratio','lines_per_method','huge_folder_total']){
    const card=document.querySelector(`[data-overview-metric="${key}"]`);
    check(card.classList.contains('has-issue'),key+' 正常场景仍标注真实异常');
    check(card.querySelector('.metric-delta').textContent.includes('—'),key+' 不给确定差值');
    const stat=document.querySelector(`[data-static-metric="${key}"]`);
    check(stat.children[3].textContent==='—'&&!!stat.querySelector('.notice'),key+' 静态受限');
  }
  check(![...document.querySelectorAll('[data-action="open-file"]')].some(n=>n.dataset.value==='src/unknown.h'),'未知文件不归方向列表');
  await click('[data-action="view"][data-value="metrics"]');
  check(document.querySelector('[data-summary-metric="huge_folder_total"]').textContent.includes('覆盖不一致'),'全部指标传播目录覆盖');
  check(document.querySelector('[data-summary-metric="code_duplication_ratio"]').textContent.includes('未知'),'全部指标传播重复行未知');
  if(window.__anomalyComparison)check(document.querySelector('[data-summary-metric="code_size"]').textContent.includes('cmetrics_version')&&document.querySelector('[data-summary-metric="code_size"]').textContent.includes('路径映射'),'版本/映射原因可见');
  await click('[data-action="view"][data-value="workspace"]');
  await click('[data-action="status"][data-value="all"]');
  const row=document.querySelector('[data-action="select"][data-value="file:src/unknown.h"]').closest('tr');
  check(row.children[2].textContent==='未知'&&row.children[3].textContent==='—','文件未知原值和差值');
  await click('[data-action="analysis-type"][data-value="huge_method_ratio"]');
  await click('[data-action="status"][data-value="all"]');
  const method=[...document.querySelectorAll('.data-table [data-action="select"]')].find(node=>node.textContent==='unknown-lines');
  check(method.closest('tr').textContent.includes('同名函数')&&method.closest('tr').textContent.includes('未知'),'歧义与未知同时标注');
  method.click();await wait();
  const evidence=document.querySelector('.evidence-panel').textContent;
  check(evidence.includes('阈值变化')&&evidence.includes('同名函数')&&evidence.includes('未知'),'组合原因详情可见');
  check(document.querySelector('.impact-unavailable').textContent.includes('数据未知')&&!document.querySelector('[data-action="contributor"]'),'未知禁止净影响排名');
  await click('[data-action="analysis-type"][data-value="huge_folder_total"]');
  await click('[data-action="status"][data-value="all"]');
  await click('[data-action="select"][data-value="folder:src/limited"]');
  const directory=document.querySelector('.evidence-panel').textContent;
  check(directory.includes('扫描申报数')&&directory.includes('恢复成员数')&&directory.includes('覆盖受限'),'目录口径分别显示');
  check(state().scenario==='normal','全程没有演示开关');
  return {result:'passed',checks,comparison:!!window.__anomalyComparison};
})();
