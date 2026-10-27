(() => {
  const checks=[];
  const assert=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
  const query=selector=>document.querySelector(selector);
  const all=selector=>[...document.querySelectorAll(selector)];
  const state=()=>JSON.parse(query('.state-inspector pre').textContent);
  const click=selector=>{const element=query(selector);assert(!!element,`入口存在：${selector}`);element.click();};
  const goMetrics=()=>click('[data-action="view"][data-value="metrics"]');
  const data=JSON.parse(query('#report-data').textContent);
  const names=data.meta.metricNames;
  const groups=[
    ['常规指标',['code_size','lines_per_file','lines_per_method','cyclomatic_complexity_per_method','code_duplication_ratio','file_duplication_ratio','unsafe_functions_total','redundant_code_total','non_hfile_code_duplication_ratio','non_hfile_duplication_ratio']],
    ['超大指标',['huge_headerfile_total','huge_headerfile_ratio','huge_non_headerfile_total','huge_non_headerfile_ratio','huge_method_total','huge_method_ratio','huge_cyclomatic_complexity_total','huge_cyclomatic_complexity_ratio','huge_folder_total','huge_folder_ratio']]
  ];
  const limits={hugeHeader:['huge_headerfile','行'],hugeSource:['huge_non_headerfile','行'],hugeMethod:['huge_method','行'],hugeCC:['huge_cyclomatic_complexity',''],folders:['huge_folder','个']};
  const fmt=(value,decimal=false)=>(Math.abs(value)<.005?0:value).toLocaleString('zh-CN',{minimumFractionDigits:decimal?2:0,maximumFractionDigits:2});
  const width=()=>assert(document.documentElement.scrollWidth<=innerWidth,`页面无横向溢出（${innerWidth}px）`);
  assert(state().view==='metrics'&&state().scenario==='normal','从正常全部指标页开始');
  assert(!query('.metrics-support').open,'过程数据默认折叠');
  assert(all('.metrics-section').map(node=>node.getAttribute('aria-label')).join()==='常规指标,超大指标','主页面分成常规指标和超大指标');
  for(const [label,keys] of groups){
    const section=query(`.metrics-section[aria-label="${label}"]`);
    assert([...section.querySelectorAll('[data-summary-metric]')].map(row=>row.dataset.summaryMetric).join()===keys.join(),`${label}的10项指标和顺序正确`);
    assert([...section.querySelectorAll('.metrics-table th')].map(node=>node.textContent).join()==='指标,基线,当前,变化',`${label}表头一致`);
  }
  const summaryKeys=Object.keys(data.baseline.summary_metrics).filter(key=>typeof data.baseline.summary_metrics[key]==='number');
  const displayed=all('[data-summary-metric]').map(row=>row.dataset.summaryMetric);
  assert(displayed.length===34&&new Set(displayed).size===34,'33项汇总和1项最大值各展示一次');
  assert(summaryKeys.every(key=>displayed.includes(key))&&displayed.includes('maximum_nbnc_loc'),'全部原始数值指标保留');
  for(const row of all('[data-summary-metric]')){
    const key=row.dataset.summaryMetric;
    for(const [index,side] of [[1,'baseline'],[2,'current']]){
      const value=key==='maximum_nbnc_loc'?data[side].detail_metrics.method_metrics.at(-1)[key]:data[side].summary_metrics[key];
      const decimal=/(_ratio|_kloc|_per_file|_per_method)$/.test(key);
      assert(row.cells[index].textContent===`${fmt(value,decimal)}${key.endsWith('_ratio')?'%':''}`,`${key}的${side}值来自原始报告`);
    }
  }
  for(const key of ['raw_lines','files_total','methods_total','folders_total','maximum_cyclomatic_complexity','maximum_nbnc_loc'])assert(query(`.metrics-support [data-summary-metric="${key}"]`),`${key}位于过程数据`);
  assert(all('.threshold-condition').length===5,'五类超限条件各展示一次');
  for(const [type,[key,unit]] of Object.entries(limits)){
    const rule=query(`[data-threshold-type="${type}"]`);
    assert(rule.textContent.includes(`> ${fmt(data.baseline.summary_metrics.huge_threshold[key])}${unit?` ${unit}`:''}`),`${type}显示严格大于和单位`);
    assert(!rule.textContent.includes('基线')&&!rule.textContent.includes('当前'),`${type}相同阈值不重复两侧数值`);
    assert(query(`[data-huge-type="${type}"]`).querySelectorAll('[data-summary-metric]').length===2,`${type}数量与比例共用规则`);
  }
  width();
  click('.metrics-support summary');
  assert(query('.metrics-support').open,'过程数据可展开');
  assert(all('.metrics-support [data-summary-metric]').every(row=>row.getBoundingClientRect().height>0),'14项过程数据展开可见');
  width();
  click('.metrics-support summary');
  assert(!query('.metrics-support').open,'过程数据可折叠');
  for(const [,keys] of groups)for(const key of keys){
    click(`[data-summary-metric="${key}"] [data-action="metric"]`);
    assert(state().view==='workspace'&&state().metric===key,`${key}跳转保留指标身份`);
    assert(query('.analysis-metrics [aria-pressed="true"]').textContent===names[key],`${key}分析选中名称正确`);
    if(key.startsWith('huge_'))assert(query('.threshold-note .threshold-condition'),`${key}分析使用相同阈值展示`);
    width();goMetrics();
  }
  for(const type of Object.keys(limits))for(const status of ['entered','exited']){
    const source=query(`[data-huge-type="${type}"] [data-status="${status}"]`);
    assert(source?.textContent.includes('1'),`${type} ${status}显示1项`);
    click(`[data-huge-type="${type}"] [data-status="${status}"]`);
    assert(state().type===type&&state().status===status&&state().result===1,`${type} ${status}精确下钻1项`);
    assert(state().sort===(status==='exited'?'delta:asc':'delta:desc'),'新增与退出按对应方向排序');
    width();goMetrics();
  }
  const scenario=query('[data-change="scenario"]');scenario.value='limited';scenario.dispatchEvent(new Event('change',{bubbles:true}));
  const cc=query('[data-threshold-type="hugeCC"]');
  assert(cc.textContent.includes('基线 > 20')&&cc.textContent.includes('当前 > 25')&&cc.textContent.includes('阈值变化'),'变化阈值明确显示基线20和当前25');
  for(const key of ['huge_cyclomatic_complexity_total','huge_cyclomatic_complexity_ratio','huge_folder_total','huge_folder_ratio']){
    const row=query(`[data-summary-metric="${key}"]`);
    assert(row.querySelector('.badge.warning')&&row.cells[3].textContent.startsWith('—'),`${key}异常不输出确定差值`);
  }
  for(const type of ['hugeCC','folders']){
    const movements=query(`[data-huge-type="${type}"]`).querySelectorAll('.movement');
    assert([...movements].every(button=>button.textContent.includes('—')&&!button.classList.contains('growth')&&!button.classList.contains('decrease')),`${type}不可比较的进出不显示0和方向色`);
    click(`[data-huge-type="${type}"] .movement`);
    assert(state().status==='exceptions'&&state().result>0,`${type}异常进出入口显示异常明细`);
    assert(query('.threshold-note .threshold-condition'),`${type}异常分析显示阈值`);
    width();goMetrics();
  }
  click('.metrics-support summary');width();
  const normal=query('[data-change="scenario"]');normal.value='normal';normal.dispatchEvent(new Event('change',{bubbles:true}));
  assert(!query('.metrics-support').open,'切换场景后过程数据恢复默认折叠');
  return {result:'passed',checks:checks.length,viewport:innerWidth};
})();
