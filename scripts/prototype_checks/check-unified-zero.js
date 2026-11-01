/* 空报告12项均值/比例：三页与静态都明确不适用，不显示确定零差值。 */
(async()=>{
  let checks=0;
  const assert=(ok,message)=>{checks++;if(!ok)throw new Error(message);};
  const wait=async()=>{const deadline=performance.now()+15000;while(document.documentElement.dataset.queryState==='loading'){if(performance.now()>deadline)throw new Error('超时');await new Promise(requestAnimationFrame);}assert(document.documentElement.dataset.queryState==='ready','查询失败');};
  const click=async selector=>{document.querySelector(selector).click();await wait();};
  const metrics=['lines_per_file','lines_per_method','cyclomatic_complexity_per_method','code_duplication_ratio','file_duplication_ratio','non_hfile_code_duplication_ratio','non_hfile_duplication_ratio','huge_headerfile_ratio','huge_non_headerfile_ratio','huge_method_ratio','huge_cyclomatic_complexity_ratio','huge_folder_ratio'];
  await wait();await click('[data-action="view"][data-value="metrics"]');
  for(const key of metrics){
    const row=document.querySelector(`[data-summary-metric="${key}"]`);
    assert([...row.children].slice(1,3).every(cell=>cell.textContent==='不适用'),key+' 全部指标两侧');
    assert(row.children[3].textContent.startsWith('—'),key+' 全部指标差值');
  }
  await click('[data-action="view"][data-value="overview"]');
  for(const key of metrics){
    const card=document.querySelector(`[data-overview-metric="${key}"]`);
    assert(card.classList.contains('has-issue'),key+' 异常保留');
    assert([...card.querySelectorAll('.metric-bottom b')].every(node=>node.textContent==='不适用'),key+' 概览两侧');
  }
  await click('[data-action="view"][data-value="workspace"]');
  for(const key of metrics){
    await click(`[data-action="analysis-type"][data-value="${key}"]`);
    assert([...document.querySelectorAll('.analysis-total span b')].every(node=>node.textContent==='不适用'),key+' 分析标题两侧');
    assert(document.querySelector('.analysis-total>b').textContent.startsWith('—'),key+' 分析标题差值');
    assert(document.querySelector('.average-explanation').textContent.includes('不适用')&&!document.querySelector('[data-action="contributor"]'),key+' 禁止排名');
  }
  const rows=[...document.querySelectorAll('#fallback tbody tr')].filter(row=>row.children[0]?.tagName==='TD');
  assert(rows.length===20,'静态20项');
  for(const row of rows.filter(row=>row.children[1].textContent==='不适用')){
    assert(row.children[2].textContent==='不适用'&&row.children[3].textContent==='—','静态零分母抑制差值');
  }
  assert(rows.filter(row=>row.children[1].textContent==='不适用').length===12,'静态12项不适用');
  return {result:'passed',checks};
})();
