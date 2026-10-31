(() => {
  const results=[];
  const assert=(value,message)=>{if(!value)throw new Error(message);results.push(message);};
  const click=selector=>document.querySelector(selector).click();
  const state=()=>JSON.parse(document.querySelector('.state-inspector pre').textContent);
  const setDirections=selected=>{for(const direction of ['growth','decrease','unchanged'])if(state().overviewChanges.includes(direction)!==selected.includes(direction))click(`[data-action="overview-toggle"][data-value="${direction}"]`);};
  const scene=document.querySelector('[data-change="scenario"]');scene.value='limited';scene.dispatchEvent(new Event('change',{bubbles:true}));
  const issues=['code_size','lines_per_file','code_duplication_ratio','non_hfile_code_duplication_ratio','huge_folder_total','huge_folder_ratio'];
  for(const selected of [[],['unchanged'],['decrease'],['growth','decrease']]){
    setDirections(selected);
    for(const key of issues){
      const card=document.querySelector(`[data-overview-metric="${key}"]`);
      assert(card?.classList.contains('has-issue'), `${selected} 保留异常 ${key}`);
      assert(card.querySelector('.metric-delta').textContent.includes('—')&&!card.querySelector('.metric-direction').textContent.includes('无变化'), '异常未标为零或无变化');
    }
    assert(document.documentElement.scrollWidth<=innerWidth,'异常概览无横向溢出');
  }
  for(const key of ['huge_folder_ratio']){
    const card=document.querySelector(`[data-overview-metric="${key}"]`);
    assert([...card.querySelectorAll('.movement')].every(e=>e.textContent.includes('—')),'不可比较的进出显示未知');
    card.querySelector('.movement').click();
    assert(state().status==='exceptions'&&state().result>0,'未知进出跳转异常明细');
    assert(!document.querySelector('.data-table .badge:not(.warning)'),'异常列表不带无变化标记');
    click('[data-action="view"][data-value="overview"]');
  }
  setDirections(['growth','decrease']);
  for(const key of ['huge_cyclomatic_complexity_total','huge_cyclomatic_complexity_ratio']){
    const card=document.querySelector(`[data-overview-metric="${key}"]`);
    assert(card&&!card.classList.contains('has-issue'),'阈值变化保留观测变化分类');
    assert(!card.querySelector('.metric-delta').textContent.includes('—'),'阈值变化显示观测差值');
    assert(card.querySelector('.metric-warning').textContent.includes('阈值变化'),'阈值提示独立展示');
    assert([...card.querySelectorAll('.movement')].every(e=>e.textContent.includes('1')),'阈值变化仍显示清单进出');
    card.querySelector('.movement').click();
    assert(state().status==='entered'&&state().result===1,'阈值变化可下钻新增超限');
    assert(document.querySelector('.threshold-note').textContent.includes('不证明代码恶化或改善'),'详情显示阈值解释边界');
    click('[data-action="view"][data-value="overview"]');
  }
  const fallback=document.querySelector('#fallback');
  assert(fallback.querySelectorAll('tbody tr:has(td)').length===20,'静态兜底保留20项指标');
  assert([...fallback.querySelectorAll('tbody th')].map(e=>e.textContent).join()==='常规指标,超大指标','静态兜底分组一致');
  const normal=document.querySelector('[data-change="scenario"]');normal.value='normal';normal.dispatchEvent(new Event('change',{bubbles:true}));
  return {checks:results.length,result:'passed'};
})();
