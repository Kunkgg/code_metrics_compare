/* 一次性原型：A 指标驾驶舱 / B 三栏分析工作台 / C 任务式评审。
 * 小规模全量内存查询，无 Worker、持久化、源码访问；不代表 PRD 容量机制已实现。 */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = value => value == null ? '未知' : Number(value).toLocaleString('zh-CN', {maximumFractionDigits:6});
  const deltaText = value => value == null ? '—' : `${value > 0 ? '+' : ''}${fmt(value)}`;
  const cls = value => value > 0 ? 'up' : value < 0 ? 'down' : 'muted';
  const badge = (text, style = '') => `<span class="badge ${style}">${esc(text)}</span>`;
  const union = (a,b) => [...new Set([...a,...b])];
  const total = (items, getter) => items.reduce((sum,item) => sum + getter(item),0);
  const knownDelta = (b,c) => b == null || c == null ? null : Math.round((c-b)*1e6)/1e6;
  const mainMetrics = [
    ['code_size','非空非注释代码量','有效代码行','code'],
    ['lines_per_file','平均文件代码行','行 / 文件','code'],
    ['lines_per_method','平均函数代码行','行 / 函数','methodLines'],
    ['cyclomatic_complexity_per_method','平均圈复杂度','复杂度 / 函数','cc'],
    ['code_duplication_ratio','代码重复率','%','duplication'],
    ['file_duplication_ratio','文件重复率','%','dupfiles'],
    ['unsafe_functions_total','危险函数','去重位置数','unsafe'],
    ['redundant_code_total','冗余代码','代码块数','redundant'],
    ['huge_cyclomatic_complexity_total','超大圈复杂度','函数数','hugeCC'],
    ['huge_method_total','超大函数','函数数','hugeMethod'],
    ['huge_headerfile_total','超大头文件','文件数','hugeHeader'],
    ['huge_non_headerfile_total','超大源文件','文件数','hugeSource'],
    ['huge_folder_total','超大目录','目录数','folders']
  ];
  const support = {
    raw_lines:['物理总行数','物理行'], files_total:['文件总数','文件'],folders_total:['目录总数','目录'],methods_total:['函数总数','函数'],
    method_lines:['函数有效代码行总量','有效代码行'],cyclomatic_complexity_total:['圈复杂度总量','复杂度'],maximum_cyclomatic_complexity:['最大圈复杂度','复杂度'],
    huge_cyclomatic_complexity_ratio:['超大圈复杂度比例','%'],huge_method_ratio:['超大函数比例','%'],huge_headerfile_ratio:['超大头文件比例','%'],
    huge_non_headerfile_ratio:['超大源文件比例','%'],huge_folder_ratio:['超大目录比例','%'],file_duplication_total:['重复文件成员并集','文件'],
    non_hfile_duplication_total:['重复非头文件成员并集','文件'],non_hfile_duplication_ratio:['重复非头文件 / 全部文件','%'],code_duplication_total:['有效重复行总量','有效行'],
    non_hfile_code_duplication_total:['非头文件有效重复行','有效行'],non_hfile_code_duplication_ratio:['非头文件重复行 / 全部代码行','%'],
    unsafe_functions_kloc:['危险函数密度','位置 / KLOC'],redundant_code_kloc:['冗余代码密度','块 / KLOC']
  };
  const types = {
    code:['文件代码行','有效代码行'],duplication:['文件重复行','有效重复行'],methodLines:['函数代码行','有效代码行'],cc:['函数圈复杂度','复杂度'],
    dupfiles:['重复文件','成员资格 0/1'],unsafe:['危险函数','去重位置记录 0/1'],redundant:['冗余代码','代码块记录 0/1'],
    hugeHeader:['超大头文件','有效代码行'],hugeSource:['超大源文件','有效代码行'],hugeMethod:['超大函数','有效代码行'],hugeCC:['超大圈复杂度','复杂度'],folders:['超大目录','直接子项']
  };
  const tasks = [
    ['整体增长来自哪里？','目录贡献与净零内部变化','code','先确认可加总量，再找到主要变化目录。目录净零不代表内部没有变化。'],
    ['哪些函数可以可靠配对？','函数增长与同名歧义','cc','只配对两侧均唯一的文件路径 + 函数名。同名记录完整保留，不按行号猜测。'],
    ['重复增长关联到哪里？','两侧重复组与完整片段','duplication','先看文件有效重复行，再查看各扫描内的重复组；相同编号不代表跨版本身份。'],
    ['目录里能看到哪些成员？','直接子项与覆盖范围','folders','扫描给出的直接子项数与可恢复成员数分开展示，不把扫描视图当作磁盘全貌。'],
    ['哪些结论暂时不能得出？','可比性与数据质量','quality','检查未知值、阈值变化和汇总冲突。原始值可读，不等于可以直接比较。']
  ];
  const variantNames = {A:'指标驾驶舱',B:'分析工作台',C:'任务式评审'};
  let DATA, model, state;

  function buildModel() {
    const reports = {baseline:structuredClone(DATA.baseline),current:structuredClone(DATA.current)};
    const limited = state.scenario === 'limited';
    if (limited) {
      const report = reports.current;
      report.summary_metrics.code_size += 123;
      report.detail_metrics.file_sizes[DATA.meta.storyPaths.utilsGrow][2] = null;
      report.summary_metrics.huge_threshold.huge_cyclomatic_complexity = 25;
      const count = report.detail_metrics.method_metrics.slice(0,-1).filter(m => m.cyclomatic_complexity > 25).length;
      report.summary_metrics.huge_cyclomatic_complexity_total = count;
      report.summary_metrics.huge_cyclomatic_complexity_ratio = count / report.summary_metrics.methods_total * 100;
      report.detail_metrics.huge_folders[DATA.meta.storyPaths.bulk] += 3;
    }
    const root = `${DATA.meta.commonRoot}/`;
    const rel = path => path.startsWith(root) ? path.slice(root.length) : path;
    const sides = {};
    for (const side of ['baseline','current']) {
      const report = reports[side], d = report.detail_metrics;
      const files = Object.fromEntries(Object.entries(d.file_sizes).map(([p,v]) => [rel(p),v]));
      const methods = d.method_metrics.slice(0,-1).map(m => ({...m,path:rel(m.file_name)}));
      const groups = Object.entries(d.code_duplication).map(([id,members]) => ({id,members:members.map(m => ({...m,path:rel(m.file_name)}))}));
      const dupfiles = Object.entries(d.duplication_files).map(([id,members]) => ({id,members:members.map(rel)}));
      const folders = Object.fromEntries(Object.entries(d.huge_folders).map(([p,n]) => [rel(p),n]));
      const positions = [];
      for (const [path,names] of Object.entries(d.unsafe_functions)) {
        for (const [name,lines] of Object.entries(names)) {
          for (const line of new Set(lines)) positions.push({kind:'unsafe',path:rel(path),name,line,id:JSON.stringify([rel(path),name,line])});
        }
      }
      for (const [path,lines] of Object.entries(d.redundant_code)) {
        const occurrences = {};
        for (const line of lines) {
          const index = occurrences[line] ?? 0; occurrences[line] = index + 1;
          positions.push({kind:'redundant',path:rel(path),name:'redundant_code_block',line,id:JSON.stringify([rel(path),line,index])});
        }
      }
      sides[side] = {report,summary:report.summary_metrics,files,methods,groups,dupfiles,folders,positions};
    }
    const b=sides.baseline,c=sides.current;
    const fileRows=union(Object.keys(b.files),Object.keys(c.files)).sort().map(path => {
      const signature = side => JSON.stringify([side.methods.filter(m=>m.path===path),side.positions.filter(p=>p.path===path),side.groups.filter(g=>g.members.some(m=>m.path===path)).map(g=>g.members),side.dupfiles.filter(g=>g.members.includes(path)).map(g=>g.members)]);
      return {id:`file:${path}`,kind:'file',path,name:path.split('/').pop(),before:b.files[path],after:c.files[path],otherMetric:JSON.stringify(b.files[path])!==JSON.stringify(c.files[path]),structural:signature(b)!==signature(c)};
    });
    const methodMaps={baseline:new Map(),current:new Map()};
    for(const side of ['baseline','current']) for(const m of sides[side].methods) {
      const key=JSON.stringify([m.path,m.method_name]);
      if(!methodMaps[side].has(key)) methodMaps[side].set(key,[]);
      methodMaps[side].get(key).push(m);
    }
    const methodRows=union(methodMaps.baseline.keys(),methodMaps.current.keys()).map(key=>{
      const before=methodMaps.baseline.get(key)||[],after=methodMaps.current.get(key)||[],m=after[0]||before[0];
      return {id:`method:${key}`,kind:'method',path:m.path,name:m.method_name,before,after,ambiguous:before.length>1||after.length>1,structural:JSON.stringify(before)!==JSON.stringify(after)};
    });
    const dirs=new Set(['']);
    for(const row of fileRows){const parts=row.path.split('/');for(let i=1;i<parts.length;i++)dirs.add(parts.slice(0,i).join('/'));}
    const folderRows=union(Object.keys(b.folders),Object.keys(c.folders)).map(path=>({id:`folder:${path}`,kind:'folder',path,name:path.split('/').pop()}));
    return {sides,fileRows,methodRows,dirs:[...dirs].sort(),folderRows,rel,limited};
  }
  const inDirectory = (path,dir) => !dir || path===dir || path.startsWith(`${dir}/`);
  function directMembers(side,path) {
    const members=new Map();
    for(const p of Object.keys(model.sides[side].files)) if(p.startsWith(`${path}/`)) {
      const rest=p.slice(path.length+1),parts=rest.split('/');
      members.set(parts[0],{name:parts[0],path:`${path}/${parts[0]}`,type:parts.length===1?'直接文件':'直接子目录'});
    }
    return [...members.values()].sort((a,b)=>a.name.localeCompare(b.name));
  }
  const isHeader = path => /\.(h|hh|hpp|hxx)$/.test(path);
  const thresholdKey = type => ({hugeHeader:'huge_headerfile',hugeSource:'huge_non_headerfile',hugeMethod:'huge_method',hugeCC:'huge_cyclomatic_complexity',folders:'huge_folder'}[type]);
  function decorated(row,b,c,extra={}) {
    const delta=row.ambiguous?null:knownDelta(b,c);
    const entered=extra.entered??(!row.before?.length&&!!row.after?.length);
    const exited=extra.exited??(!!row.before?.length&&!row.after?.length);
    const unknown=b==null||c==null;
    const flags=[];
    if(row.ambiguous)flags.push('ambiguous');else if(unknown)flags.push('unknown');
    if(extra.incomparable)flags.push('incomparable');
    if(delta>0&&!extra.incomparable)flags.push('growth');
    if(delta<0&&!extra.incomparable)flags.push('decrease');
    if(entered)flags.push('entered');if(exited)flags.push('exited');
    if(row.structural&&delta===0)flags.push('structural');
    const changed=flags.length>0||row.structural||row.otherMetric;
    return {...row,b,c,delta,flags,changed,...extra};
  }
  function rowsFor(type) {
    const b=model.sides.baseline,c=model.sides.current;
    if(['code','duplication','hugeHeader','hugeSource','dupfiles'].includes(type)) {
      let rows=model.fileRows;
      if(type==='hugeHeader')rows=rows.filter(r=>isHeader(r.path));
      if(type==='hugeSource')rows=rows.filter(r=>!isHeader(r.path));
      return rows.map(row=>{
        const index=type==='duplication'?2:0;
        let before=row.before?row.before[index]:0,after=row.after?row.after[index]:0;
        let extra={};
        if(type==='dupfiles') {
          before=Number(b.dupfiles.some(g=>g.members.includes(row.path)));
          after=Number(c.dupfiles.some(g=>g.members.includes(row.path)));
          extra={entered:!before&&!!after,exited:!!before&&!after};
        }
        const key=thresholdKey(type);
        if(key)extra={entered:!(before>b.summary.huge_threshold[key])&&after>c.summary.huge_threshold[key],exited:before>b.summary.huge_threshold[key]&&!(after>c.summary.huge_threshold[key])};
        return decorated(row,before,after,extra);
      }).filter(row=>{
        if(type==='dupfiles')return row.b||row.c;
        const key=thresholdKey(type);
        return !key||row.b>b.summary.huge_threshold[key]||row.c>c.summary.huge_threshold[key];
      });
    }
    if(['methodLines','cc','hugeMethod','hugeCC'].includes(type)) {
      const field=['cc','hugeCC'].includes(type)?'cyclomatic_complexity':'nbnc_loc',key=thresholdKey(type);
      return model.methodRows.filter(row=>!key||row.before.some(m=>m[field]>b.summary.huge_threshold[key])||row.after.some(m=>m[field]>c.summary.huge_threshold[key])).map(row=>{
        const before=row.ambiguous?null:row.before[0]?.[field]??0,after=row.ambiguous?null:row.after[0]?.[field]??0;
        let extra={};
        if(key&&!row.ambiguous)extra={entered:!(before>b.summary.huge_threshold[key])&&after>c.summary.huge_threshold[key],exited:before>b.summary.huge_threshold[key]&&!(after>c.summary.huge_threshold[key])};
        if(key==='huge_cyclomatic_complexity'&&model.limited)extra.incomparable=true;
        return decorated(row,before,after,extra);
      });
    }
    if(['unsafe','redundant'].includes(type)) {
      const bm=new Map(b.positions.filter(p=>p.kind===type).map(p=>[p.id,p])),cm=new Map(c.positions.filter(p=>p.kind===type).map(p=>[p.id,p]));
      return union(bm.keys(),cm.keys()).map(key=>{
        const before=bm.get(key),after=cm.get(key),p=after||before;
        return decorated({...p,id:`${type}:${key}`,before,after},before?1:0,after?1:0,{entered:!before&&!!after,exited:!!before&&!after});
      });
    }
    return model.folderRows.map(row=>{
      const before=b.folders[row.path]??directMembers('baseline',row.path).length,after=c.folders[row.path]??directMembers('current',row.path).length;
      return decorated(row,before,after,{structural:true,entered:!b.folders[row.path]&&!!c.folders[row.path],exited:!!b.folders[row.path]&&!c.folders[row.path],incomparable:model.limited&&row.path===model.rel(DATA.meta.storyPaths.bulk)});
    });
  }
  const statusNames={growth:'增长',decrease:'减少',entered:'扫描集合进入',exited:'扫描集合退出',structural:'结构 / 位置变化',ambiguous:'匹配歧义',unknown:'未知',incomparable:'不可直接比较'};
  function rowStatus(row) {
    if(!row.flags.length)return badge(row.structural?'关联结构变化':row.otherMetric?'其他度量变化':'数值未变');
    return row.flags.map(flag=>{
      let name=statusNames[flag];
      if(['entered','exited'].includes(flag)) {
        if(['unsafe','redundant'].includes(row.kind)) name=flag==='entered'?'扫描记录新增':'扫描记录消失';
        else if(thresholdKey(state.type))name=flag==='entered'?'超限清单进入':'超限清单退出';
        else if(state.type==='dupfiles')name=flag==='entered'?'重复记录进入':'重复记录退出';
      }
      return badge(name,['ambiguous','unknown','incomparable'].includes(flag)?'warning':flag==='growth'?'growth':flag==='decrease'?'decrease':'');
    }).join(' ');
  }
  function queriedRows() {
    let rows=rowsFor(state.type);
    const allCount=rows.length;
    const scope=state.searchScope==='all'?'':state.directory;
    rows=rows.filter(r=>inDirectory(r.path,scope));
    const scopeCount=rows.length;
    const exceptionCount=rows.filter(r=>r.flags.some(f=>['ambiguous','unknown','incomparable'].includes(f))).length;
    const q=state.query.trim().toLowerCase();
    if(q)rows=rows.filter(r=>`${r.path} ${r.name}`.toLowerCase().includes(q));
    if(state.status==='changes')rows=rows.filter(r=>r.changed);
    else if(state.status!=='all')rows=rows.filter(r=>r.flags.includes(state.status));
    const min=state.min===''?null:Number(state.min),max=state.max===''?null:Number(state.max);
    if(min!=null||max!=null)rows=rows.filter(r=>r[state.numeric]!=null&&(min==null||r[state.numeric]>=min)&&(max==null||r[state.numeric]<=max));
    rows.sort((a,b)=>{
      if(state.sort==='path')return `${a.path}/${a.name}`.localeCompare(`${b.path}/${b.name}`);
      const [field,direction]=state.sort.split(':');
      if(a[field]==null&&b[field]==null)return a.path.localeCompare(b.path);
      if(a[field]==null)return -1;if(b[field]==null)return 1;
      return (a[field]-b[field])*(direction==='asc'?1:-1)||a.path.localeCompare(b.path);
    });
    return {rows,allCount,scopeCount,exceptionCount,scope};
  }
  function aggregate(dir,type) {
    const result={};
    for(const side of ['baseline','current']) {
      const s=model.sides[side];
      let vals;
      if(['methodLines','cc','hugeMethod','hugeCC'].includes(type))vals=s.methods.filter(m=>inDirectory(m.path,dir)).map(m=>m[['cc','hugeCC'].includes(type)?'cyclomatic_complexity':'nbnc_loc']);
      else vals=Object.entries(s.files).filter(([p])=>inDirectory(p,dir)).map(([,v])=>v[type==='duplication'?2:0]);
      result[side]={value:vals.some(v=>v==null)?null:total(vals,v=>v),valid:vals.filter(v=>v!=null).length,count:vals.length};
    }
    return {...result,delta:knownDelta(result.baseline.value,result.current.value)};
  }
  function summaryStatus(key) {
    if(model.limited&&['code_size','lines_per_file','unsafe_functions_kloc','redundant_code_kloc'].includes(key))return '汇总或分母冲突 · 不作增长判定';
    if(model.limited&&key.includes('code_duplication'))return '明细覆盖不完整';
    if(model.limited&&key.startsWith('huge_cyclomatic'))return '阈值变化 · 不可直接比较';
    if(model.limited&&key==='huge_folder_total')return '成员覆盖受限';
    return '合成口径一致';
  }
  const brand=()=>`<div class="brand"><span class="brand-mark"><i></i><i></i><i></i></span><span>Cmetrics</span></div>`;
  function scenarioSelect(){return `<select class="scenario" aria-label="模拟数据场景" data-change="scenario"><option value="normal" ${state.scenario==='normal'?'selected':''}>正常合成数据 · 含歧义</option><option value="limited" ${state.scenario==='limited'?'selected':''}>异常演示 · 受限报告</option></select>`;}
  function banner(){return `<div class="notice global-warning"><strong>△ ${model.limited?'受限报告 · 异常演示':'局部受限 · 函数匹配'}</strong><span>${model.limited?'当前侧含汇总冲突、重复行未知、圈复杂度阈值变化及目录覆盖差异；受影响结论不作可靠判断。':'2 个同名函数键存在歧义，相关逐函数差值已屏蔽；两侧原始记录和自身聚合仍保留。'}</span><button data-action="view" data-value="quality">查看影响范围 ↗</button></div>`;}
  function identity(){return `<div class="identity">${['baseline','current'].map((side,i)=>`${i?'<div class="identity-arrow">→</div>':''}<div class="identity-side ${side}"><span class="side-letter">${i?'C':'B'}</span><div><strong>${side} <span class="muted">/</span> ${esc(DATA.meta.identities[side].version)}</strong><code>${esc(DATA.meta.identities[side].branch)}</code><p>节点：未提供 · mock-scan-v1.0.0 · ${fmt(model.sides[side].summary.files_total)} 文件 / ${fmt(model.sides[side].summary.methods_total)} 函数</p></div></div>`).join('')}</div>`;}
  function metricCard(metric,index,compact=false) {
    const [key,label,unit,type]=metric,b=model.sides.baseline.summary[key],c=model.sides.current.summary[key],d=knownDelta(b,c),status=summaryStatus(key),limited=status!=='合成口径一致';
    return `<button class="metric-card ${compact?'compact':''}" data-action="metric" data-value="${type}" data-metric="${key}" title="来源：summary_metrics.${key}；${status}；精确差值 ${deltaText(d)}${unit==='%'?' 个百分点':''}"><span class="metric-name">${esc(label)} <span class="muted small">${String(index+1).padStart(2,'0')} ↗</span></span><div class="metric-value number">${fmt(c)}<small>${esc(unit)}</small></div><div class="metric-bottom"><span>B <span class="number">${fmt(b)}</span></span><span class="${limited?'muted':cls(d)}">${deltaText(d)}${unit==='%'?' pp':''} ${limited?'观测差':d>0?'↑ 待评审':d<0?'↓ 减少':'持平'}</span></div><div class="metric-source">扫描汇总 · ${esc(status)}</div></button>`;
  }
  function supportTable(){
    const all=[...mainMetrics.map(([key,label,unit])=>[key,[label,unit]]),...Object.entries(support)];
    return `<div class="table-wrap"><table><thead><tr><th>字段 / 名称</th><th class="num">Baseline</th><th class="num">Current</th><th class="num">差值</th><th>单位 / 状态</th></tr></thead><tbody>${all.map(([key,[name,unit]])=>{
      const b=model.sides.baseline.summary[key],c=model.sides.current.summary[key];
      return `<tr><td>${esc(name)}<code class="row-subtitle">${key}</code></td><td class="num">${fmt(b)}</td><td class="num">${fmt(c)}</td><td class="num">${deltaText(knownDelta(b,c))}${unit==='%'?' pp':''}</td><td>${esc(unit)}<span class="row-subtitle">${esc(summaryStatus(key))}</span></td></tr>`;
    }).join('')}<tr><td>函数有效代码行最大值<code class="row-subtitle">method_metrics[-1].maximum_nbnc_loc</code></td><td class="num">${fmt(DATA.baseline.detail_metrics.method_metrics.at(-1).maximum_nbnc_loc)}</td><td class="num">${fmt(DATA.current.detail_metrics.method_metrics.at(-1).maximum_nbnc_loc)}</td><td class="num">${deltaText(DATA.current.detail_metrics.method_metrics.at(-1).maximum_nbnc_loc-DATA.baseline.detail_metrics.method_metrics.at(-1).maximum_nbnc_loc)}</td><td>有效代码行 · 非新增主指标</td></tr></tbody></table></div>`;
  }
  function chart(type='code') {
    const chartType=['code','duplication','methodLines','cc'].includes(type)?type:'code';
    const dirs=model.dirs.filter(d=>d==='include'||/^src\/[^/]+$/.test(d));
    const rows=dirs.map(path=>({path,file:false,...aggregate(path,chartType)}));
    // 不重叠地补上分组目录以外的直属文件，使图中贡献与全局可加总量守恒。
    for(const file of model.fileRows.filter(r=>!dirs.some(dir=>inDirectory(r.path,dir))))rows.push({path:file.path,file:true,...aggregate(file.path,chartType)});
    rows.sort((a,b)=>(b.delta??-Infinity)-(a.delta??-Infinity));
    const maximum=Math.max(1,...rows.map(r=>Math.abs(r.delta??0)));
    return `<div class="panel-head"><h2>目录变化分布</h2>${badge(types[chartType][0],'teal')}</div><div>${rows.map(r=>`<div class="chart-row"><button data-action="${r.file?'chart-file':'directory'}" data-value="${esc(r.path)}" data-type="${chartType}">${esc(r.path)}${r.file?'（直属文件）':''} ↗</button><div class="bar-track">${r.delta!=null&&r.delta!==0?`<span class="bar ${r.delta<0?'negative':'positive'}" style="width:${Math.abs(r.delta)/maximum*49}%"></span>`:''}</div><span class="number ${cls(r.delta)}">${deltaText(r.delta)}</span></div>`).join('')}</div><p class="chart-caption">全报告 · ${types[chartType][1]}差值降序 · 展示全部 ${dirs.length} 个目录分组及 ${rows.length-dirs.length} 个直属文件；分组互不重叠，贡献可与全局总量核对。目录递归聚合，净零目录仍可进入。</p><button class="text" data-action="workspace">进入完整记录列表 →</button>`;
  }
  function tree(){return `<div class="panel-head"><h3>扫描目录</h3>${badge('递归范围')}</div><div class="directory-tree">${model.dirs.map(dir=>{
    const count=model.fileRows.filter(r=>inDirectory(r.path,dir)).length;
    return `<button data-action="directory" data-value="${esc(dir)}" class="${state.directory===dir?'active':''}" style="padding-left:${8+(dir?dir.split('/').length-1:0)*12}px"><span class="folder-icon">${dir?'▱':'▦'}</span><span>${esc(dir?dir.split('/').pop():'全部扫描范围')}</span><span class="tree-count">${count}</span></button>`;
  }).join('')}</div><div class="tree-legend">数量为两侧文件路径并集。<br>目录度量覆盖后代文件；超大目录的直接成员另行展示。</div>`;}
  function typeTabs(){return `<div class="type-tabs">${Object.entries(types).map(([key,[name]])=>`<button data-action="type" data-value="${key}" class="${state.type===key?'active':''}">${esc(name)}${['methodLines','cc'].includes(key)?' [受限]':''}</button>`).join('')}</div>`;}
  function controls() {
    return `<form id="query-form" class="toolbar"><label class="search">标识搜索（Enter 或点击查询）<input name="query" aria-label="路径、函数名或危险函数名" placeholder="搜索路径、函数名…" value="${esc(state.query)}"></label><label>范围<select data-change="searchScope" aria-label="查询范围"><option value="directory" ${state.searchScope==='directory'?'selected':''}>当前目录及后代</option><option value="all" ${state.searchScope==='all'?'selected':''}>全报告 · 当前类型</option></select></label><label>变化状态<select data-change="status" aria-label="变化状态">${[['changes','全部变化及异常'],['all','全部保留记录'],...Object.entries(statusNames)].map(([v,n])=>`<option value="${v}" ${state.status===v?'selected':''}>${n}</option>`).join('')}</select></label><label>排序<select data-change="sort" aria-label="排序">${[['delta:desc','差值 ↓'],['delta:asc','差值 ↑'],['b:desc','Baseline ↓'],['b:asc','Baseline ↑'],['c:desc','Current ↓'],['c:asc','Current ↑'],['path','标识 A → Z']].map(([v,n])=>`<option value="${v}" ${state.sort===v?'selected':''}>${n}</option>`).join('')}</select></label><label>数值字段<select data-change="numeric" aria-label="数值筛选字段">${[['delta','差值'],['b','Baseline'],['c','Current']].map(([v,n])=>`<option value="${v}" ${state.numeric===v?'selected':''}>${n}</option>`).join('')}</select></label><label>最小值<input name="min" type="number" step="any" aria-label="最小值" placeholder="不限" value="${esc(state.min)}"></label><label>最大值<input name="max" type="number" step="any" aria-label="最大值" placeholder="不限" value="${esc(state.max)}"></label><button type="submit" class="primary">查询</button><button type="button" data-action="reset" title="清除文本、范围和筛选条件">重置</button></form>`;
  }
  function table() {
    const q=queriedRows(),pages=Math.max(1,Math.ceil(q.rows.length/state.pageSize));
    state.page=Math.min(state.page,pages);
    const slice=q.rows.slice((state.page-1)*state.pageSize,state.page*state.pageSize);
    const threshold=thresholdKey(state.type);
    const scope=aggregate(q.scope,state.type);
    const additive=['code','duplication','methodLines','cc'].includes(state.type);
    return `<div class="scope-title"><strong>${esc(q.scope||'全部扫描范围')}</strong><span class="muted">/ ${types[state.type][0]}</span>${badge(types[state.type][1])}</div>${typeTabs()}${controls()}<div class="conditions"><strong>${q.rows.length} 条命中</strong><span>/ 范围内 ${q.scopeCount} 条 · 当前类型全报告 ${q.allCount} 条</span>${badge(state.status==='changes'?'全部变化及异常':state.status==='all'?'全部保留记录':statusNames[state.status])}${state.query?badge(`搜索：${state.query}`):''}<span>查询覆盖全部页；不包含源码。</span></div>${q.exceptionCount?`<div class="notice" style="margin-bottom:12px">此范围存在 ${q.exceptionCount} 条异常／歧义记录。即使当前筛选未命中，也不代表异常已消失。</div>`:''}${threshold?`<div class="notice neutral" style="margin-bottom:12px">严格大于阈值才超限：Baseline &gt; ${model.sides.baseline.summary.huge_threshold[threshold]} / Current &gt; ${model.sides.current.summary.huge_threshold[threshold]}。退出清单保留实际数值，不补零。${state.type==='hugeCC'&&model.limited?' 阈值变化，清单进出不可解释为可靠质量变化。':''}</div>`:''}${additive?`<div class="conditions">完整范围聚合（筛选前）：B ${fmt(scope.baseline.value)} → C ${fmt(scope.current.value)}，Δ ${deltaText(scope.delta)}；有效对象 B ${scope.baseline.valid}/${scope.baseline.count}，C ${scope.current.valid}/${scope.current.count}。${['cc','methodLines'].includes(state.type)?'含歧义原始值各自聚合，不等于逐函数配对覆盖。':''}</div>`:''}<div class="table-wrap"><table><thead><tr><th>对象 / 定位标识</th><th class="num">Baseline</th><th class="num">Current</th><th class="num">Δ 差值</th><th>状态（可同时成立）</th></tr></thead><tbody>${slice.length?slice.map(row=>`<tr class="${state.selected===row.id?'selected':''}"><td><button class="row-title" data-action="select" data-value="${esc(row.id)}">${esc(row.kind==='file'||row.kind==='folder'?row.path:row.name)} ↗</button><span class="row-subtitle">${row.kind==='method'?`${esc(row.path)} · ${row.ambiguous?'两侧原始记录待查':`B L${row.before[0]?.start_line??'—'} / C L${row.after[0]?.start_line??'—'}`}`:['unsafe','redundant'].includes(row.kind)?`${esc(row.path)} : ${row.line}`:row.kind==='folder'?'扫描直接子项 · 非递归总量':`B ${row.before?'存在':'不在扫描集合'} / C ${row.after?'存在':'不在扫描集合'}`}</span></td><td class="num number">${row.ambiguous?`${row.before.length} 条原始记录`:fmt(row.b)}</td><td class="num number">${row.ambiguous?`${row.after.length} 条原始记录`:fmt(row.c)}</td><td class="num number ${row.flags.includes('incomparable')?'muted':cls(row.delta)}">${deltaText(row.delta)}</td><td><div class="status-list">${rowStatus(row)}</div></td></tr>`).join(''):'<tr><td colspan="5" class="empty">没有符合当前条件的记录。<br>这是正常无匹配，不代表全报告无变化。<br><button class="text" data-action="reset">清除条件</button></td></tr>'}</tbody></table></div><div class="pagination"><span>${q.rows.length?`${(state.page-1)*state.pageSize+1}–${Math.min(state.page*state.pageSize,q.rows.length)}`:'0'} / ${q.rows.length} 条 · 每页 ${state.pageSize} 条</span><div class="row"><button data-action="page" data-value="-1" ${state.page===1?'disabled':''}>← 上一页</button><span>${state.page} / ${pages}</span><button data-action="page" data-value="1" ${state.page===pages?'disabled':''}>下一页 →</button></div></div>`;
  }
  function locationText(row) {
    const side=row.after&&(row.kind==='method'?row.after.length:true)?'Current':'Baseline';
    if(row.kind==='method') {
      if(row.ambiguous)return `[CMP-LOC] Side: Baseline + Current | Path: ${row.path} | Symbol: ${row.name} | Status: Ambiguous; no reliable per-method delta`;
      const m=row.after[0]||row.before[0],field=['cc','hugeCC'].includes(state.type)?'cyclomatic_complexity':'nbnc_loc';
      return `[CMP-LOC] Side: ${side} | Path: ${row.path} | Line: ${m.start_line} | Symbol: ${row.name} | Metric: ${field}=${side==='Current'?row.c:row.b} (Baseline=${row.b}, Delta=${deltaText(row.delta)}, Status: ${row.flags.includes('incomparable')?'NotComparable':row.delta>0?'Growth':row.delta<0?'Decrease':'Observed'})`;
    }
    if(row.kind==='unsafe'||row.kind==='redundant')return `[CMP-LOC] Side: ${side} | Path: ${row.path} | ${row.kind==='unsafe'?'Line':'StartLine'}: ${row.line}${row.kind==='unsafe'?` | Symbol: ${row.name}`:''} | Issue: ${row.kind==='unsafe'?'unsafe_function':'redundant_code_block'} (Status: ${row.flags.includes('entered')?'Added':row.flags.includes('exited')?'Disappeared':'Observed'}; scan record only)`;
    return `[CMP-LOC] Side: Baseline + Current | Path: ${row.path} | Metric: ${state.type} (Baseline=${row.b??'Unknown'}, Current=${row.c??'Unknown'}, Delta=${deltaText(row.delta)}, Status: ${row.flags.join(',')||'Observed'})`;
  }
  function groupsFor(path) {
    return ['baseline','current'].map(side=>{
      const groups=model.sides[side].groups.filter(g=>g.members.some(m=>m.path===path));
      return `<div class="evidence-section"><h3>${side} · ${groups.length} 个关联重复组</h3>${groups.length?groups.map(g=>`<div class="notice neutral"><strong>${esc(g.id)}</strong> · ${g.members.length} 个片段</div>${g.members.map(m=>{
        const loc=`[CMP-LOC] Side: ${side==='baseline'?'Baseline':'Current'} | Path: ${m.path} | StartLine: ${m.start_line} | DuplicationLength: ${m.code_duplication} | Group: ${g.id}`;
        return `<div class="raw-row"><strong class="mono">${esc(m.path)}</strong><p>起始行 ${m.start_line} · 有效长度 ${m.code_duplication}（不反算物理结束行）</p><button class="text" data-action="fragment" data-value="${esc(loc)}">取得此片段定位文本 ↗</button></div>`;
      }).join('')}`).join(''):'<p class="muted">完整清单中无关联重复片段记录；与文件不存在不同。</p>'}</div>`;
    }).join('');
  }
  function evidence() {
    let row=rowsFor(state.type).find(r=>r.id===state.selected);
    if(!row)return `<div class="evidence"><div class="eyebrow">OBJECT INSPECTOR</div><h2>定位证据</h2><p class="muted" style="margin-top:14px">选择表格中的对象，查看两侧原始度量、关联片段与可复制定位文本。</p><div class="notice neutral" style="margin-top:25px">不包含源码，不读取本地代码库，不执行扫描命令。</div></div>`;
    let content='';
    if(row.kind==='file') {
      content+=`<div class="evidence-section"><h3>文件原始度量</h3><div class="table-wrap"><table><thead><tr><th>字段</th><th>Baseline</th><th>Current</th></tr></thead><tbody>${['有效代码行','物理总行','有效重复行'].map((name,i)=>`<tr><td>${name}</td><td>${row.before?fmt(row.before[i]):'不在扫描集合'}</td><td>${row.after?fmt(row.after[i]):'不在扫描集合'}</td></tr>`).join('')}</tbody></table></div><p class="muted small">来自 file_sizes[path][0 / 1 / 2]。重复行不是重复片段长度的简单加总。</p></div><div class="file-actions">${[['cc','函数圈复杂度'],['methodLines','函数代码行'],['duplication','重复片段'],['unsafe','危险函数'],['redundant','冗余块'],['dupfiles','重复文件']].map(([type,label])=>`<button data-action="related" data-value="${type}" data-path="${esc(row.path)}">${label} ↗</button>`).join('')}</div>`;
      if(state.type==='duplication')content+=`<div class="notice" style="margin-top:17px">组身份限定于单次扫描，以下两侧组不作身份匹配。未增长的必要关联文件也完整保留。</div>${groupsFor(row.path)}`;
      if(state.type==='dupfiles')content+=['baseline','current'].map(side=>`<div class="evidence-section"><h3>${side} · 重复文件组</h3>${model.sides[side].dupfiles.filter(g=>g.members.includes(row.path)).map(g=>`<div class="raw-row"><strong>组 ${esc(g.id)}</strong>${g.members.map(p=>`<p class="mono">${esc(p)}</p>`).join('')}</div>`).join('')||'<p class="muted">无重复文件记录。</p>'}</div>`).join('');
    } else if(row.kind==='method') {
      if(row.ambiguous)content+=`<div class="notice">[受限] 匹配歧义：Baseline ${row.before.length} 条 / Current ${row.after.length} 条同名记录。禁止任选配对，禁止按行号强配，不输出逐函数差值。</div>`;
      for(const [side,items] of [['Baseline',row.before],['Current',row.after]])content+=`<div class="evidence-section"><h3>${side} · ${items.length} 条普通函数原始记录</h3>${items.map(m=>`<div class="raw-row"><strong>${esc(m.method_name)}</strong> · L${m.start_line}–${m.end_line}<p>有效代码行 ${m.nbnc_loc} · 圈复杂度 ${m.cyclomatic_complexity}</p><button class="text" data-action="fragment" data-value="${esc(`[CMP-LOC] Side: ${side} | Path: ${row.path} | Line: ${m.start_line} | Symbol: ${row.name} | Metric: nbnc_loc=${m.nbnc_loc}, cyclomatic_complexity=${m.cyclomatic_complexity} | Status: ${row.ambiguous?'Ambiguous; no delta':'Observed'}`)}">取得此原始记录定位文本 ↗</button></div>`).join('')||'<p class="muted">不在该侧扫描函数集合。</p>'}</div>`;
    } else if(row.kind==='folder') {
      content+=`<div class="notice">仅展示扫描可见直接成员。目录后代文件不作为直接文件；无法恢复磁盘空目录。</div>`;
      for(const side of ['baseline','current']) {
        const members=directMembers(side,row.path),observed=model.sides[side].folders[row.path];
        content+=`<div class="evidence-section"><h3>${side} · 直接成员</h3><p>扫描提供：<strong>${observed??'未在超大目录清单'}</strong> · 可恢复：<strong>${members.length}</strong></p>${observed!=null&&observed!==members.length?'<div class="notice">计数与可恢复成员不一致。覆盖受限，不能补造缺失名称。</div>':''}<div class="table-wrap"><table><thead><tr><th>直接成员名称</th><th>类型</th></tr></thead><tbody>${members.map(m=>`<tr><td><code>${esc(m.name)}</code></td><td>${m.type}</td></tr>`).join('')}</tbody></table></div></div>`;
      }
    } else {
      content+=`<div class="notice neutral">${row.kind==='unsafe'?'粒度是（文件、危险函数名、行号）的去重位置记录。同一行不同名称分别计数。':'数量单位是代码块，保留原始条目，不按起始行擅自去重。'}<br>行号移动可能导致记录新增／消失，不能据此声称问题新增或已修复。</div>`;
    }
    return `<div class="evidence"><div class="evidence-head"><div class="eyebrow">OBJECT INSPECTOR / 定位证据</div><h2 class="object-path mono">${esc(row.kind==='method'?row.name:row.path)}</h2>${row.kind==='method'?`<p class="mono muted">${esc(row.path)}</p>`:''}<div class="status-list" style="margin-top:12px">${rowStatus(row)}</div></div><div class="pair-values"><div><small>BASELINE · ${types[state.type][1]}</small><strong class="number">${row.ambiguous?'歧义':fmt(row.b)}</strong></div><div><small>CURRENT · ${types[state.type][1]}</small><strong class="number">${row.ambiguous?'歧义':fmt(row.c)}</strong></div></div>${content}<div class="evidence-section"><div class="row between"><h3>定位文本</h3><button data-action="copy" class="text">复制定位信息</button></div><textarea id="location-text" readonly aria-label="可手动选择的定位文本">${esc(state.locationOverride||locationText(row))}</textarea><p class="muted small">复制失败时可直接选中文本；不跳转 IDE、不读取源码。</p></div></div>`;
  }
  function quality() {
    const unique=model.methodRows.filter(r=>!r.ambiguous&&r.before.length===1&&r.after.length===1).length;
    const b=model.sides.baseline,c=model.sides.current;
    return `<div class="page-head"><div><div class="eyebrow">TRUST & PROVENANCE</div><h1>数据质量与报告说明</h1><p>先确认可以知道什么，再决定如何解释变化。</p></div>${badge(model.limited?'异常演示 · 受限':'正常合成夹具 · 匹配局部受限','warning')}</div>${identity()}<div class="quality-grid"><section class="panel"><div class="panel-head"><h2>校验与身份匹配</h2>${badge('正常夹具已校验','teal')}</div><p>两侧正常合成文件实际执行 L0、L1、L2、L3；不扩大为真实扫描语义验证。</p><div class="key-value"><span>文件匹配</span><strong>${model.fileRows.filter(r=>r.before&&r.after).length} 个共有路径 / ${model.fileRows.length} 个并集路径</strong><span>可靠函数配对</span><strong>${unique} 对 / 两侧各 ${b.methods.length}、${c.methods.length} 条原始函数</strong><span>歧义键</span><strong>${model.methodRows.filter(r=>r.ambiguous).length} 个；各侧 ${total(model.methodRows.filter(r=>r.ambiguous),r=>r.before.length)} / ${total(model.methodRows.filter(r=>r.ambiguous),r=>r.after.length)} 条记录被隔离</strong><span>函数最大值</span><span>尾对象不计入普通函数数；最大有效行与最大圈复杂度见完整字段表。</span></div><div class="notice">同名歧义只限制逐函数解释；两侧原始有效值仍可各自聚合。L3 仅验证现有内部模型规则与台账结构，不能证明真实片段覆盖或全部台账语义。</div></section><section class="panel"><h2>保留与查询边界</h2><ul><li>本原型全部小规模明细保留；省略 0 条。</li><li>重复组全部相关片段、超大目录直接成员均可达。</li><li>文本检索字段：相对路径、函数名、危险函数名、超大目录路径。</li><li>“全报告 · 当前类型”检索此类型所有目录与所有页；不是跨类型全文检索，不检索源码。</li><li>每页 ${state.pageSize} 条仅是展示限制；先查询与排序完整列表，再分页。</li><li>主线程小规模内存查询，无 Worker、压缩分块或预建紧凑索引；不构成 P1 容量结论。</li></ul></section><section class="panel full"><div class="panel-head"><h2>就地诊断与受影响结论</h2>${badge(model.limited?'4 类异常注入 + 匹配歧义':'匹配歧义','warning')}</div><div class="table-wrap"><table><thead><tr><th>侧别 / 对象</th><th>诊断</th><th>处理边界</th></tr></thead><tbody><tr><td>两侧 · src/core/parser.c</td><td>parse、func_worker 同文件同名</td><td>两侧原始记录保留；不生成全排列或确定逐函数差值</td></tr>${model.limited?`<tr><td>Current · summary_metrics.code_size</td><td>扫描汇总 ${fmt(c.summary.code_size)} ≠ 明细派生 ${fmt(total(Object.values(c.files),v=>v[0]))}</td><td>冲突影响汇总及其派生比例口径；观测差异不作可靠增长结论</td></tr><tr><td>Current · src/utils/grow.c</td><td>文件重复行 null；未知不是 0</td><td>重复行完整聚合与逐文件差值不可得；扫描汇总原值仍保留，未声称复算通过</td></tr><tr><td>两侧 · huge_cyclomatic_complexity</td><td>阈值 20 → 25</td><td>依各侧阈值严格 &gt; 派生；超限清单不可直接比较，不影响普通圈复杂度原值</td></tr><tr><td>Current · src/bulk</td><td>扫描直接子项 ${c.folders['src/bulk']} / 可恢复 ${directMembers('current','src/bulk').length}</td><td>覆盖受限，不补造磁盘成员；异常展示未通过正常夹具 L2</td></tr>`:''}</tbody></table></div></section><section class="panel"><h2>扫描与生成溯源</h2><div class="key-value"><span>生成器 / 数据格式</span><span>${esc(DATA.meta.generatorVersion)} / ${esc(DATA.meta.dataFormatVersion)}</span><span>随机种子</span><span class="mono">${DATA.meta.seed}</span><span>扫描工具</span><span>${esc(b.summary.cmetrics_version)}</span><span>扫描命令</span><code>${esc(b.summary.command)}</code><span>元信息来源</span><span>合成演示身份，未验证；节点未提供。命令只展示，永不执行。</span></div>${['baseline','current'].map(side=>`<p class="small muted">${side} 输入 SHA-256</p><code>${esc(DATA.meta.sha256[side])}</code>`).join('')}<p class="muted small">摘要指向磁盘正常夹具，异常演示是内存副本，不改变原始 JSON。</p></section><section class="panel"><h2>口径与未验证项</h2><ul><li>增长仅表示待评审，不自动证明质量下降，不生成综合分。</li><li>比例差值用百分点；均值由总量及分母重算，不对均值作贡献相加。</li><li>超限使用严格 &gt;；扫描集合进出不证明磁盘真实新增／删除。</li><li>静态概览由 Python 预生成；脚本失败不冒充交互已就绪。</li><li>尚未验证 10 万文件 / 100 万函数、200 MiB、P95、峰值内存或真实输入。</li><li>原型不支持根层级漂移场景与生产适配，不代表 PRD 全部已实现。</li></ul></section><section class="panel full"><h2>33 项汇总 + 必要明细最大值</h2><p class="muted small" style="margin:8px 0 17px">来源：各侧 summary_metrics 扫描原值；包含 13 项主指标与 20 项支撑度量。抑制告警不参与。异常场景中的差值仅为观测差值。</p>${supportTable()}</section></div>`;
  }
  function inspector(){const q=queriedRows();return `<details class="state-inspector"><summary>原型状态 / 比较时检查当前条件 · ${state.variant} · ${state.scenario} · ${q.rows.length} 条命中</summary><pre>${esc(JSON.stringify({...state,result:{scope:q.scope,type:state.type,retained:q.allCount,matched:q.rows.length},data:{seed:DATA.meta.seed,omitted:0},persistence:'仅内存；只有 variant 写入 URL'},null,2))}</pre></details>`;}
  const footer=()=>`<div class="footer-note">合成数据 · 一次性 UI 原型 · 非正式验收报告 · 离线单 HTML / 无源码 / 无持久化</div>`;
  const taskLinks=()=>tasks.map((task,i)=>`<button class="task-link" data-action="task" data-value="${i}"><span class="task-num">0${i+1}</span><span><strong>${task[0]}</strong><small>${task[1]}</small></span><span class="spacer"></span><span class="muted">↗</span></button>`).join('');
  function overview(){return `<div class="page-head"><div><div class="eyebrow">SCAN COMPARISON / OVERVIEW</div><h1>看见变化，找到证据。</h1><p>synthetic / cmetrics-demo <span class="muted">&nbsp;·&nbsp;</span> 两次全量扫描的离线对比</p></div><button class="primary" data-action="workspace">进入分析工作区 ↗</button></div>${identity()}<div class="mini-summary"><span><strong>${mainMetrics.filter(([key])=>summaryStatus(key)==='合成口径一致'&&model.sides.current.summary[key]>model.sides.baseline.summary[key]).length}</strong> 项增长 / 待评审</span><span><strong>13</strong> 项主看护指标</span><span><strong>2</strong> 个歧义匹配键</span><span>合成口径，不代表真实质量结论</span></div><div class="metrics-grid">${mainMetrics.slice(0,4).map((m,i)=>metricCard(m,i)).join('')}</div><div class="overview-grid"><section class="panel">${chart()}</section><section class="panel"><div class="panel-head"><h2>从一个问题开始</h2>${badge('5 项业务任务')}</div>${taskLinks()}</section></div><div class="panel-head" style="margin-top:27px"><h2>重复、问题记录与超限</h2><button class="text" data-action="view" data-value="quality">查看全部 33 项支撑与汇总 →</button></div><div class="metrics-grid metrics-secondary">${mainMetrics.slice(4).map((m,i)=>metricCard(m,i+4,true)).join('')}</div>`;}
  function workspaceA(){return `<div class="page-head"><div><div class="eyebrow">ANALYSIS WORKSPACE</div><h1>沿着变化，逐层下钻。</h1><p>Baseline → Current · ${types[state.type][0]} · 目录聚合与定位证据</p></div><button data-action="view" data-value="overview">← 返回概览</button></div><div class="workspace-shell"><aside class="panel">${tree()}</aside><section class="panel table-panel">${table()}</section></div>`;}
  function VariantA(){return `<div class="layout-a"><aside class="a-sidebar"><div class="brand"><span class="brand-mark"><i></i><i></i><i></i></span><span>Cmetrics<span class="sub">COMPARE & EXPLORE</span></span></div><div class="nav-caption">离线对比报告</div><nav>${[['overview','▦','报告概览'],['workspace','⌘','分析工作区'],['quality','◇','数据质量与说明']].map(([v,icon,name])=>`<button data-action="view" data-value="${v}" class="${state.view===v?'active':''}"><span>${icon}</span>${name}</button>`).join('')}</nav><div style="margin-top:32px;padding:0 12px"><span class="prototype-tag">PROTOTYPE A</span><p class="small muted" style="margin-top:13px;line-height:1.9">从整体信号开始，<br>逐层收敛到对象证据。</p></div><div class="sidebar-foot">● 自包含离线报告<br>模拟数据 · seed ${DATA.meta.seed}<br>不自动判断根因或责任</div></aside><header class="topbar"><div class="crumb">工作区 / <strong>synthetic / cmetrics-demo</strong></div><div class="row">${badge('● 离线 · 内嵌数据','teal')}${scenarioSelect()}</div></header>${banner()}<main class="a-content">${state.view==='quality'?quality():state.view==='workspace'?workspaceA():overview()}${inspector()}${footer()}</main>${state.view==='workspace'&&state.selected?`<div class="drawer-backdrop" data-action="close"></div><aside class="drawer" role="dialog" aria-label="对象定位证据"><button class="close icon" data-action="close" aria-label="关闭对象详情">✕</button>${evidence()}</aside>`:''}</div>`;}
  function VariantB(){return `<div class="layout-b"><header class="b-mast">${brand()}<span class="prototype-tag">LAB / B</span><nav>${[['workspace','分析工作台'],['overview','指标全览'],['quality','数据质量']].map(([v,n])=>`<button class="${state.view===v?'active':''}" data-action="view" data-value="${v}">${n}</button>`).join('')}</nav><span class="spacer"></span>${scenarioSelect()}</header>${banner()}<div class="b-context"><div><div class="eyebrow">SYNTHETIC / CMETRICS-DEMO</div><h1>目录 · 明细 · 证据，一屏联查</h1></div><span class="muted">Baseline <code>v1-demo</code> → Current <code>v2-demo</code> &nbsp; ${badge('全量扫描','teal')}</span></div>${state.view==='workspace'?`<div class="b-metric-strip">${[mainMetrics[0],mainMetrics[4],mainMetrics[3],mainMetrics[12]].map(([key,name,unit,type])=>`<button data-action="metric" data-value="${type}" data-metric="${key}"><span><span class="small muted">${name}</span><strong class="number">${fmt(model.sides.current.summary[key])}<small class="muted"> ${unit}</small></strong></span><span class="${summaryStatus(key)==='合成口径一致'?cls(model.sides.current.summary[key]-model.sides.baseline.summary[key]):'muted'}">${deltaText(knownDelta(model.sides.baseline.summary[key],model.sides.current.summary[key]))}${unit==='%'?' pp':''}</span></button>`).join('')}</div><main class="b-grid"><aside class="panel b-tree">${tree()}</aside><section class="panel table-panel">${table()}</section><aside class="panel b-evidence">${evidence()}</aside></main>`:`<main class="b-wide">${state.view==='quality'?quality():`<div class="panel-head"><h2>13 项主指标</h2><button class="text" data-action="view" data-value="quality">全部支撑字段 →</button></div>${identity()}<div class="metrics-grid">${mainMetrics.map((m,i)=>metricCard(m,i,true)).join('')}</div>`}</main>`}<div class="b-state">${inspector()}${footer()}</div></div>`;}
  function taskFinding(){
    const d=knownDelta(model.sides.baseline.summary.code_size,model.sides.current.summary.code_size);
    const findings=[
      [deltaText(d),'有效代码行 · 扫描汇总观测差','core 中 parser.c 增长 280 行，legacy.c 减少 220 行。utils 净变化为 0，但 grow.c 与 shrink.c 分别 +90 / −90；必须继续查看内部对象。'],
      ['+10','parse_token · 圈复杂度差值','唯一键 parse_token 可以配对，圈复杂度 18 → 28。parse 与 func_worker 各有两条同名记录，差值被隔离；不能据行号生成确定配对。'],
      ['+20','parser.c · 文件有效重复行','parser.c 重复行 20 → 40；关联文件 shared.c 仍为 40。选择 parser.c 后，查看两侧各自的重复组及全部必要片段。'],
      [`${model.sides.current.folders['src/bulk']}`,'src/bulk · Current 扫描直接子项',`可恢复 ${directMembers('current','src/bulk').length} 个直接成员，其中 nested 是子目录，不把 nested/leaf.c 列作直接文件。${model.limited?'扫描计数与可见成员不一致，覆盖受限。':'计数吻合也不证明扫描覆盖磁盘空目录。'}`]
    ];
    const [value,label,copy]=findings[state.task]||findings[0];
    return `<div class="c-finding"><div><div class="eyebrow">OBSERVED / 已观测</div><div class="big-number number">${esc(value)}</div><span class="small muted">${esc(label)}</span></div><div class="finding-copy">${esc(copy)}${model.limited&&state.task===0?'<br><strong>异常场景：扫描汇总冲突，此差值不可作可靠增长判定。</strong>':''}</div></div>`;
  }
  function VariantC(){const task=tasks[state.task],contextual=state.type!==task[2];return `<div class="layout-c"><header class="c-mast">${brand()}<span class="report-label">一份报告，五个需要回答的问题</span><div class="row"><span class="prototype-tag">PROTOTYPE C</span>${scenarioSelect()}</div></header>${banner()}<div class="c-grid"><aside class="c-index"><div class="index-title">REVIEW NOTE / 阅读目录</div>${tasks.map((t,i)=>`<button class="c-step ${state.task===i?'active':''}" data-action="task" data-value="${i}"><span class="step-n">0${i+1}</span><span><strong>${t[0]}</strong><small>${t[1]}</small></span></button>`).join('')}<div class="index-bottom">这不是自动评审结论。<br>报告的终点是取得定位证据，<br>后续请在现有工具检查源码。<div class="divider"></div><button class="text" data-action="view" data-value="overview">查看 13 项完整指标 ↗</button></div></aside><main class="c-content">${state.view==='overview'?`${identity()}<div class="page-head"><h1>全部看护指标</h1><button data-action="task" data-value="0">返回任务阅读</button></div><div class="metrics-grid">${mainMetrics.map((m,i)=>metricCard(m,i,true)).join('')}</div>`:state.task===4||state.view==='quality'?quality():`<header class="c-heading"><div class="eyebrow">${contextual?'关联分析 · 当前对象类型':'QUESTION 0'+(state.task+1)+' / AT-0'+(state.task+1)}</div><h1>${contextual?`关联分析：${types[state.type][0]}`:task[0]}</h1><p>${contextual?'当前表格已切换到关联对象；不沿用其他任务的固定观察结论。可从左侧目录返回五项任务。':task[3]}</p></header>${identity()}${contextual?'':taskFinding()}${!contextual&&state.task===0?`<section class="panel">${chart()}</section>`:''}<div class="c-evidence-title"><span class="eyebrow">EVIDENCE</span><h2>在完整数据中核对</h2></div><section class="panel">${table()}</section>${state.selected?`<section class="panel detail-inline">${evidence()}</section>`:''}<div class="c-next"><small>没有评审结果保存，也不自动作出根因判断。</small><button data-action="task" data-value="${state.task+1}" class="primary">下一个问题 →</button></div>`}${inspector()}${footer()}</main></div></div>`;}
  function PrototypeSwitcher(){
    if(!PROTOTYPE_MODE)return '';
    return `<div class="switcher" role="navigation" aria-label="原型方案切换"><span>UI LAB · 3 个方案</span><button class="arrow" data-action="cycle" data-value="-1" aria-label="上一个原型">←</button>${Object.entries(variantNames).map(([v,n])=>`<button data-action="variant" data-value="${v}" class="${state.variant===v?'active':''}" aria-pressed="${state.variant===v}">${v} · ${n}</button>`).join('')}<button class="arrow" data-action="cycle" data-value="1" aria-label="下一个原型">→</button><span class="shortcut">← → 切换</span></div>`;
  }
  function render(){
    $('#app').innerHTML=({A:VariantA,B:VariantB,C:VariantC}[state.variant])();
    $('#switcher').innerHTML=PrototypeSwitcher();
    document.documentElement.classList.add('interactive-ready');
    document.title=`${state.variant} · ${variantNames[state.variant]} | Cmetrics 原型`;
    console.info('[prototype state]',structuredClone(state));
  }
  function resetQuery(){Object.assign(state,{query:'',status:'changes',sort:'delta:desc',numeric:'delta',min:'',max:'',searchScope:'directory',page:1,selected:null,locationOverride:null});}
  function selectInitial(){const first=queriedRows().rows.find(r=>r.path==='src/core/parser.c'&&!r.ambiguous)||queriedRows().rows[0];state.selected=first?.id??null;}
  function setTask(index){state.task=Number(index);state.view=state.task===4?'quality':'workspace';resetQuery();state.directory='';if(state.task<4)state.type=tasks[state.task][2];if(state.task===1)state.query='src/core/parser.c';if(state.task===2)state.query='src/core/parser.c';if(state.task===3)state.query='src/bulk';if(state.variant!=='A'&&state.task<4)selectInitial();}
  function setVariant(variant,updateURL=true){
    state.variant=variant;
    if(updateURL){const url=new URL(location.href);url.searchParams.set('variant',variant);history.replaceState(null,'',url);}
    // 比较布局时保留筛选和选择，只切换顶层展示方式。
    if(variant==='B'&&state.view==='overview')state.view='workspace';
    if(variant==='C'&&state.view!=='quality'){state.view='workspace';const i=tasks.findIndex(t=>t[2]===state.type);state.task=i<0?0:i;}
    if(variant!=='A'&&state.view==='workspace'&&!state.selected)selectInitial();
    render();window.scrollTo(0,0);
  }
  function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');setTimeout(()=>$('#toast').classList.remove('visible'),2800);}
  function safeRender(){try{render();}catch(error){fail(error);}}
  function fail(error){console.error(error);document.documentElement.classList.remove('interactive-ready');$('#app').innerHTML='';$('#switcher').innerHTML='';$('#init-status').textContent=`交互初始化或渲染失败：${error.message}。仅可阅读正常合成夹具的静态概览；搜索、筛选、下钻及异常场景不可用。`;}
  document.addEventListener('click',async event=>{
    const target=event.target.closest('[data-action]');if(!target)return;
    const action=target.dataset.action,value=target.dataset.value;
    if(action==='variant'){setVariant(value);return;}
    if(action==='cycle'){const variants=['A','B','C'];setVariant(variants[(variants.indexOf(state.variant)+Number(value)+3)%3]);return;}
    if(action==='copy'){
      const area=$('#location-text');
      try{await navigator.clipboard.writeText(area.value);toast('已复制定位信息');}catch{area.focus();area.select();toast('未能自动复制，已选中文本；请按 Ctrl/Cmd+C');}return;
    }
    if(action==='fragment'){state.locationOverride=value;safeRender();$('#location-text')?.scrollIntoView({block:'center',behavior:'smooth'});return;}
    if(action==='page')state.page+=Number(value);
    if(action==='close'){state.selected=null;state.locationOverride=null;}
    if(action==='select'){state.selected=value;state.locationOverride=null;}
    if(action==='reset')resetQuery();
    if(action==='view'){state.view=value;resetQuery();state.directory='';if(value==='quality')state.task=4;}
    if(action==='workspace'){state.view='workspace';resetQuery();state.directory='';state.type='code';state.task=0;}
    if(action==='metric'||action==='type'){state.type=value;state.metric=target.dataset.metric??null;state.view='workspace';resetQuery();const i=tasks.findIndex(t=>t[2]===value);state.task=i<0?0:i;if(action==='metric')state.directory='';}
    if(action==='directory'){state.directory=value;state.view='workspace';resetQuery();}
    if(action==='chart-file'){state.view='workspace';state.type=target.dataset.type;state.directory='';resetQuery();state.query=value;}
    if(action==='related'){state.type=value;resetQuery();state.query=target.dataset.path;state.searchScope='all';state.status='all';if(value==='duplication'||value==='dupfiles')state.selected=`file:${target.dataset.path}`;}
    if(action==='task')setTask(value);
    if(['metric','type','workspace','directory','chart-file','related'].includes(action)&&state.variant!=='A'&&!state.selected)selectInitial();
    safeRender();
    if(['view','task','workspace'].includes(action))window.scrollTo(0,0);
  });
  document.addEventListener('change',event=>{
    const key=event.target.dataset.change;if(!key)return;
    // 下拉框即时查询时先保留同一表单中尚未提交的文本和数值条件。
    const form=event.target.closest('form');
    if(form){const draft=new FormData(form);state.query=String(draft.get('query')??'');state.min=String(draft.get('min')??'');state.max=String(draft.get('max')??'');}
    state[key]=event.target.value;state.page=1;state.selected=null;state.locationOverride=null;
    if(key==='scenario'){model=buildModel();resetQuery();if(state.variant!=='A')selectInitial();}
    safeRender();
  });
  document.addEventListener('submit',event=>{
    if(event.target.id!=='query-form')return;event.preventDefault();const form=new FormData(event.target);
    state.query=String(form.get('query'));state.min=String(form.get('min'));state.max=String(form.get('max'));state.page=1;state.selected=null;state.locationOverride=null;
    safeRender();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&state.selected&&state.variant==='A'){state.selected=null;safeRender();return;}
    if(!PROTOTYPE_MODE||!['ArrowLeft','ArrowRight'].includes(event.key)||event.target.closest('input,textarea,select,[contenteditable]'))return;
    event.preventDefault();const variants=['A','B','C'];setVariant(variants[(variants.indexOf(state.variant)+(event.key==='ArrowRight'?1:2))%3]);
  });
  window.addEventListener('popstate',()=>{const v=new URLSearchParams(location.search).get('variant');setVariant(variantNames[v]?v:'A',false);});
  try {
    DATA=JSON.parse($('#report-data').textContent);
    const requested=new URLSearchParams(location.search).get('variant');
    const variant=variantNames[requested]?requested:'A';
    state={variant,scenario:'normal',view:variant==='A'?'overview':'workspace',type:'code',metric:'code_size',directory:'',query:'',searchScope:'directory',status:'changes',sort:'delta:desc',numeric:'delta',min:'',max:'',page:1,pageSize:10,selected:null,locationOverride:null,task:0};
    model=buildModel();if(variant!=='A')selectInitial();
    if(new URLSearchParams(location.search).get('failInit')==='1')throw new Error('主动模拟初始化失败（failInit=1）');
    render();
  } catch(error){fail(error);}
})();
