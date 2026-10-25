/* 一次性原型第二轮：A 的指标概览 + B 的三栏分析，所有数据仅保存在内存。
 * 不含生产容量机制、源码访问或跨扫描重复组配对。 */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // 只格式化显示值，原始精度继续用于比较、筛选和排序。
  const decimalMetric = key => /(_ratio|_kloc|_per_file|_per_method)$/.test(key);
  const fmt = (value,decimal=false) => {
    if(value==null)return '未知';
    const number=Number(value),digits=decimal||!Number.isInteger(number)?2:0;
    return (Math.abs(number)<.005?0:number).toLocaleString('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits});
  };
  const deltaText = (value,decimal=false) => value == null ? '—' : `${value >= .005 ? '+' : ''}${fmt(value,decimal)}`;
  const cls = value => value > 0 ? 'up' : value < 0 ? 'down' : 'muted';
  const badge = (text, style = '') => `<span class="badge ${style}">${esc(text)}</span>`;
  const union = (a,b) => [...new Set([...a,...b])];
  const total = (items, getter) => items.reduce((sum,item) => sum + getter(item),0);
  const knownDelta = (b,c) => b == null || c == null ? null : Math.round((c-b)*1e6)/1e6;
  const mainMetrics = [
    ['code_size','行','code'],['lines_per_file','行 / 文件','code'],
    ['lines_per_method','行 / 函数','methodLines'],['cyclomatic_complexity_per_method','','cc'],
    ['code_duplication_ratio','%','duplication'],['file_duplication_ratio','%','dupfiles'],
    ['unsafe_functions_total','处','unsafe'],['redundant_code_total','块','redundant'],
    ['huge_cyclomatic_complexity_total','个','hugeCC'],['huge_method_total','个','hugeMethod'],
    ['huge_headerfile_total','个','hugeHeader'],['huge_non_headerfile_total','个','hugeSource'],['huge_folder_total','个','folders']
  ];
  // 汇总指标与明细类型分开：均值/比例保留独立入口，共用底层证据。
  const analysisCategories = [
    ['常规指标',[
      ['code_size','code'],['lines_per_file','code'],['lines_per_method','methodLines'],['cyclomatic_complexity_per_method','cc'],
      ['code_duplication_ratio','duplication'],['file_duplication_ratio','dupfiles'],['unsafe_functions_total','unsafe'],['redundant_code_total','redundant'],
      ['non_hfile_code_duplication_ratio','sourceDuplication'],['non_hfile_duplication_ratio','sourceDupfiles']
    ]],
    ['超大指标',[
      ['huge_headerfile_total','hugeHeader'],['huge_headerfile_ratio','hugeHeader'],['huge_non_headerfile_total','hugeSource'],['huge_non_headerfile_ratio','hugeSource'],
      ['huge_method_total','hugeMethod'],['huge_method_ratio','hugeMethod'],['huge_cyclomatic_complexity_total','hugeCC'],['huge_cyclomatic_complexity_ratio','hugeCC'],
      ['huge_folder_total','folders'],['huge_folder_ratio','folders']
    ]]
  ];
  const analysisMetrics = analysisCategories.flatMap(([,metrics])=>metrics);
  const defaultMetric = type => analysisMetrics.find(([,detailType])=>detailType===type)[0];
  const metricFraction = key => ({
    lines_per_file:['code_size','files_total'],lines_per_method:['method_lines','methods_total'],cyclomatic_complexity_per_method:['cyclomatic_complexity_total','methods_total'],
    code_duplication_ratio:['code_duplication_total','code_size'],file_duplication_ratio:['file_duplication_total','files_total'],
    non_hfile_code_duplication_ratio:['non_hfile_code_duplication_total','code_size'],non_hfile_duplication_ratio:['non_hfile_duplication_total','files_total'],
    huge_headerfile_ratio:['huge_headerfile_total','files_total'],huge_non_headerfile_ratio:['huge_non_headerfile_total','files_total'],
    huge_method_ratio:['huge_method_total','methods_total'],huge_cyclomatic_complexity_ratio:['huge_cyclomatic_complexity_total','methods_total'],huge_folder_ratio:['huge_folder_total','folders_total']
  }[key]);
  const typeMetrics = {code:'code_size',duplication:'code_duplication_total',sourceDuplication:'non_hfile_code_duplication_total',methodLines:'method_lines',cc:'cyclomatic_complexity_total',dupfiles:'file_duplication_total',sourceDupfiles:'non_hfile_duplication_total',unsafe:'unsafe_functions_total',redundant:'redundant_code_total',hugeHeader:'huge_headerfile_total',hugeSource:'huge_non_headerfile_total',hugeMethod:'huge_method_total',hugeCC:'huge_cyclomatic_complexity_total',folders:'huge_folder_total'};
  const typeUnits = {code:'行',duplication:'重复行',sourceDuplication:'重复行',methodLines:'行',cc:'圈复杂度',dupfiles:'重复标记',sourceDupfiles:'重复标记',unsafe:'',redundant:'',hugeHeader:'行',hugeSource:'行',hugeMethod:'行',hugeCC:'圈复杂度',folders:'直接成员'};
  const thresholdKey = type => ({hugeHeader:'huge_headerfile',hugeSource:'huge_non_headerfile',hugeMethod:'huge_method',hugeCC:'huge_cyclomatic_complexity',folders:'huge_folder'}[type]);
  const statusNames = {growth:'增长',decrease:'减少',entered:'新增',exited:'移出',ambiguous:'同名无法配对',unknown:'未知',incomparable:'不可比较'};
  let DATA, model, state;
  const metricName = key => DATA.meta.metricNames[key] ?? key;
  function selectMetric(key){state.metric=key;state.type=analysisMetrics.find(([metric])=>metric===key)[1];}
  const inDirectory = (path,dir) => !dir || path===dir || path.startsWith(`${dir}/`);
  const isHeader = path => /\.(h|hh|hpp|hxx)$/.test(path);

  function buildModel() {
    const reports={baseline:structuredClone(DATA.baseline),current:structuredClone(DATA.current)};
    const limited=state.scenario==='limited';
    if(limited) {
      const report=reports.current;
      report.summary_metrics.code_size+=123;
      report.detail_metrics.file_sizes[DATA.meta.storyPaths.utilsGrow][2]=null;
      report.summary_metrics.huge_threshold.huge_cyclomatic_complexity=25;
      const count=report.detail_metrics.method_metrics.slice(0,-1).filter(m=>m.cyclomatic_complexity>25).length;
      report.summary_metrics.huge_cyclomatic_complexity_total=count;
      report.summary_metrics.huge_cyclomatic_complexity_ratio=count/report.summary_metrics.methods_total*100;
      report.detail_metrics.huge_folders[DATA.meta.storyPaths.bulk]+=3;
    }
    const root=`${DATA.meta.commonRoot}/`,rel=path=>path===DATA.meta.commonRoot?'':path.startsWith(root)?path.slice(root.length):path;
    const sides={};
    for(const side of ['baseline','current']) {
      const report=reports[side],d=report.detail_metrics;
      const files=Object.fromEntries(Object.entries(d.file_sizes).map(([p,v])=>[rel(p),v]));
      const methods=d.method_metrics.slice(0,-1).map(m=>({...m,path:rel(m.file_name)}));
      const groups=Object.entries(d.code_duplication).map(([id,members])=>({id,members:members.map(m=>({...m,path:rel(m.file_name)}))}));
      const dupfiles=Object.entries(d.duplication_files).map(([id,members])=>({id,members:members.map(rel)}));
      const folders=Object.fromEntries(Object.entries(d.huge_folders).map(([p,n])=>[rel(p),n]));
      const positions=[];
      for(const [path,names] of Object.entries(d.unsafe_functions))for(const [name,lines] of Object.entries(names))for(const line of new Set(lines))positions.push({kind:'unsafe',path:rel(path),name,line,id:JSON.stringify([rel(path),name,line])});
      for(const [path,lines] of Object.entries(d.redundant_code)) {
        const occurrences={};
        for(const line of lines){const index=occurrences[line]??0;occurrences[line]=index+1;positions.push({kind:'redundant',path:rel(path),name:'冗余代码',line,id:JSON.stringify([rel(path),line,index])});}
      }
      sides[side]={report,summary:report.summary_metrics,files,methods,groups,dupfiles,folders,positions};
    }
    const b=sides.baseline,c=sides.current;
    const fileRows=union(Object.keys(b.files),Object.keys(c.files)).sort().map(path=>({id:`file:${path}`,kind:'file',path,name:path.split('/').pop(),before:b.files[path],after:c.files[path]}));
    const methodMaps={baseline:new Map(),current:new Map()};
    for(const side of ['baseline','current'])for(const m of sides[side].methods){const key=JSON.stringify([m.path,m.method_name]);if(!methodMaps[side].has(key))methodMaps[side].set(key,[]);methodMaps[side].get(key).push(m);}
    const methodRows=union(methodMaps.baseline.keys(),methodMaps.current.keys()).map(key=>{
      const before=methodMaps.baseline.get(key)||[],after=methodMaps.current.get(key)||[],m=after[0]||before[0];
      return {id:`method:${key}`,kind:'method',path:m.path,name:m.method_name,before,after,ambiguous:before.length>1||after.length>1};
    });
    const dirs=new Set(['']);
    for(const row of fileRows){const parts=row.path.split('/');for(let i=1;i<parts.length;i++)dirs.add(parts.slice(0,i).join('/'));}
    const folderRows=union(Object.keys(b.folders),Object.keys(c.folders)).map(path=>({id:`folder:${path}`,kind:'folder',path,name:path.split('/').pop()}));
    return {sides,fileRows,methodRows,dirs:[...dirs].sort(),folderRows,rel,limited};
  }
  function directMembers(side,path) {
    const members=new Map(),prefix=path?`${path}/`:'';
    for(const p of Object.keys(model.sides[side].files))if(p.startsWith(prefix)) {
      const parts=p.slice(prefix.length).split('/');
      const member={name:parts[0],path:`${prefix}${parts[0]}`,type:parts.length===1?'文件':'目录'};
      members.set(JSON.stringify([member.name,member.type]),member);
    }
    return [...members.values()].sort((a,b)=>a.name.localeCompare(b.name));
  }
  function memberChanges(path) {
    const b=new Map(directMembers('baseline',path).map(m=>[JSON.stringify([m.name,m.type]),m]));
    const c=new Map(directMembers('current',path).map(m=>[JSON.stringify([m.name,m.type]),m]));
    return union(b.keys(),c.keys()).map(id=>({...c.get(id)||b.get(id),before:b.has(id),after:c.has(id),status:!b.has(id)?'entered':!c.has(id)?'exited':'same'})).sort((a,b)=>({entered:0,exited:1,same:2}[a.status]-{entered:0,exited:1,same:2}[b.status])||a.name.localeCompare(b.name));
  }
  function decorated(row,b,c,extra={}) {
    const delta=row.ambiguous?null:knownDelta(b,c);
    const entered=extra.entered??(!row.before?.length&&!!row.after?.length),exited=extra.exited??(!!row.before?.length&&!row.after?.length);
    const flags=[];
    if(row.ambiguous)flags.push('ambiguous');else if(b==null||c==null)flags.push('unknown');
    if(extra.incomparable)flags.push('incomparable');
    if(delta>0&&!extra.incomparable)flags.push('growth');if(delta<0&&!extra.incomparable)flags.push('decrease');
    if(entered)flags.push('entered');if(exited)flags.push('exited');
    return {...row,b,c,delta,flags,changed:delta!==0||flags.includes('incomparable'),...extra};
  }
  function rowsFor(type) {
    if(type==='sourceDuplication'||type==='sourceDupfiles')return rowsFor(type==='sourceDuplication'?'duplication':'dupfiles').filter(row=>!isHeader(row.path));
    const b=model.sides.baseline,c=model.sides.current;
    if(['code','duplication','hugeHeader','hugeSource','dupfiles'].includes(type)) {
      let rows=model.fileRows;
      if(type==='hugeHeader')rows=rows.filter(r=>isHeader(r.path));if(type==='hugeSource')rows=rows.filter(r=>!isHeader(r.path));
      return rows.map(row=>{
        const index=type==='duplication'?2:0;let before=row.before?row.before[index]:0,after=row.after?row.after[index]:0,extra={};
        if(type==='dupfiles'){before=Number(b.dupfiles.some(g=>g.members.includes(row.path)));after=Number(c.dupfiles.some(g=>g.members.includes(row.path)));extra={entered:!before&&!!after,exited:!!before&&!after};}
        const key=thresholdKey(type);
        if(key)extra={entered:!(before>b.summary.huge_threshold[key])&&after>c.summary.huge_threshold[key],exited:before>b.summary.huge_threshold[key]&&!(after>c.summary.huge_threshold[key]),incomparable:b.summary.huge_threshold[key]!==c.summary.huge_threshold[key]};
        return decorated(row,before,after,extra);
      }).filter(row=>{if(type==='dupfiles')return row.b||row.c;const key=thresholdKey(type);return !key||row.b>b.summary.huge_threshold[key]||row.c>c.summary.huge_threshold[key];});
    }
    if(['methodLines','cc','hugeMethod','hugeCC'].includes(type)) {
      const field=['cc','hugeCC'].includes(type)?'cyclomatic_complexity':'nbnc_loc',key=thresholdKey(type);
      return model.methodRows.filter(row=>!key||row.before.some(m=>m[field]>b.summary.huge_threshold[key])||row.after.some(m=>m[field]>c.summary.huge_threshold[key])).map(row=>{
        const before=row.ambiguous?null:row.before[0]?.[field]??0,after=row.ambiguous?null:row.after[0]?.[field]??0;let extra={};
        if(key&&!row.ambiguous)extra={entered:!(before>b.summary.huge_threshold[key])&&after>c.summary.huge_threshold[key],exited:before>b.summary.huge_threshold[key]&&!(after>c.summary.huge_threshold[key])};
        if(key)extra.incomparable=b.summary.huge_threshold[key]!==c.summary.huge_threshold[key];
        return decorated(row,before,after,extra);
      });
    }
    if(['unsafe','redundant'].includes(type)) {
      const bm=new Map(b.positions.filter(p=>p.kind===type).map(p=>[p.id,p])),cm=new Map(c.positions.filter(p=>p.kind===type).map(p=>[p.id,p]));
      return union(bm.keys(),cm.keys()).map(key=>{const before=bm.get(key),after=cm.get(key),p=after||before;return decorated({...p,id:`${type}:${key}`,before,after},before?1:0,after?1:0,{entered:!before&&!!after,exited:!!before&&!after});});
    }
    return model.folderRows.map(row=>{
      const members=memberChanges(row.path),before=b.folders[row.path]??directMembers('baseline',row.path).length,after=c.folders[row.path]??directMembers('current',row.path).length;
      return decorated(row,before,after,{entered:!(row.path in b.folders)&&(row.path in c.folders),exited:(row.path in b.folders)&&!(row.path in c.folders),incomparable:b.summary.huge_threshold.huge_folder!==c.summary.huge_threshold.huge_folder||(model.limited&&row.path===model.rel(DATA.meta.storyPaths.bulk)),addedMembers:members.filter(m=>m.status==='entered').length,removedMembers:members.filter(m=>m.status==='exited').length});
    });
  }
  function transition(type) {
    const rows=rowsFor(type),comparable=rows.filter(r=>!r.ambiguous&&!r.flags.includes('incomparable'));
    return {entered:comparable.filter(r=>r.flags.includes('entered')).length,exited:comparable.filter(r=>r.flags.includes('exited')).length,limited:comparable.length!==rows.length};
  }
  function rowStatus(row) {
    const threshold=thresholdKey(state.type);
    const exceptions=row.flags.filter(f=>['ambiguous','unknown','incomparable'].includes(f));
    if(exceptions.length)return exceptions.map(f=>badge(statusNames[f],'warning')).join(' ');
    if(row.delta===0)return badge('无变化');
    const labels=[];
    if(threshold&&row.flags.includes('entered'))labels.push(badge('新增超限','growth'));
    else if(threshold&&row.flags.includes('exited'))labels.push(badge('退出超限','decrease'));
    else if(row.flags.includes('entered'))labels.push(badge(['unsafe','redundant'].includes(row.kind)?'记录新增':'新增','growth'));
    else if(row.flags.includes('exited'))labels.push(badge(['unsafe','redundant'].includes(row.kind)?'记录消失':'移出','decrease'));
    else if(row.delta>0)labels.push(badge('增长','growth'));
    else if(row.delta<0)labels.push(badge('减少','decrease'));
    return labels.join(' ');
  }
  const existenceType = () => ['dupfiles','sourceDupfiles','unsafe','redundant'].includes(state.type);
  const hasException = row => row.flags.some(flag=>['ambiguous','unknown','incomparable'].includes(flag));
  function matchesStatus(row,status=state.status) {
    if(status==='all')return true;
    if(status==='changes')return row.changed;
    if(status==='exceptions')return hasException(row);
    return row.flags.includes(status)&&(!thresholdKey(state.type)||!['entered','exited'].includes(status)||!row.flags.includes('incomparable'));
  }
  function numberMeasure() {
    if(['cc','hugeCC'].includes(state.type))return {name:'圈复杂度',unit:''};
    if(state.type==='folders')return {name:'直接成员数',unit:'个'};
    if(['duplication','sourceDuplication'].includes(state.type))return {name:'重复行数',unit:'行'};
    return {name:'代码行数',unit:'行'};
  }
  function numberFields() {
    const {name}=numberMeasure();
    return [['c',`当前${name}`],['b',`基线${name}`],['increase',`增加的${name}`],['decrease',`减少的${name}`]];
  }
  function matchesNumber(row,condition=state.numberFilter) {
    if(!condition)return true;
    let value=row[condition.field];
    if(['increase','decrease'].includes(condition.field)) {
      if(row.delta==null||row.flags.includes('incomparable'))return false;
      if(condition.field==='increase'?row.delta<=0:row.delta>=0)return false;
      value=condition.field==='increase'?row.delta:-row.delta;
    }
    if(value==null)return false;
    return condition.operator==='gte'?value>=condition.value:condition.operator==='lte'?value<=condition.value:value>=condition.value&&value<=condition.upper;
  }
  function numberDescription(condition=state.numberFilter) {
    if(!condition)return '';
    const name=numberFields().find(([field])=>field===condition.field)[1],unit=numberMeasure().unit;
    const show=value=>Number(value).toLocaleString('zh-CN',{maximumSignificantDigits:21});
    return `${name}${condition.operator==='gte'?'至少':condition.operator==='lte'?'不超过':'介于'} ${show(condition.value)}${condition.operator==='between'?` 到 ${show(condition.upper)}`:''}${unit?` ${unit}`:''}`;
  }
  function statusOptions() {
    if(thresholdKey(state.type))return [['changes','全部变化'],['entered','新增超限'],['exited','退出超限'],['all','全部对象']];
    if(existenceType())return [['changes','全部变化'],['entered',['dupfiles','sourceDupfiles'].includes(state.type)?'进入重复清单':'记录新增'],['exited',['dupfiles','sourceDupfiles'].includes(state.type)?'退出重复清单':'记录消失'],['all','全部记录']];
    return [['changes','全部变化'],['growth','只看增长'],['decrease','只看减少'],['all','全部对象']];
  }
  const sortIdentity = () => ['methodLines','cc','hugeMethod','hugeCC','unsafe'].includes(state.type)?'名称':'路径';
  function sortDescription() {
    const [field,direction]=state.sort.split(':');
    if(field==='path')return `${sortIdentity()}${direction==='asc'?' A → Z':' Z → A'}`;
    if(existenceType())return direction==='desc'?'新增在前':'消失在前';
    return `${{b:'基线',c:'当前',delta:'变化'}[field]}${direction==='asc'?'从小到大':'从大到小'}`;
  }
  function sortHeader(field,label,numeric=false) {
    const [active,direction]=state.sort.split(':'),selected=active===field;
    const next=selected?(direction==='desc'?'asc':'desc'):(field==='path'?'asc':'desc');
    const hint=field==='path'?`按${sortIdentity()}${next==='asc'?' A 到 Z':' Z 到 A'}排序`:existenceType()?`${next==='desc'?'新增':'消失'}在前`:`按${label}${next==='asc'?'从小到大':'从大到小'}排序`;
    return `<th ${numeric?'class="num"':''} aria-sort="${selected?(direction==='asc'?'ascending':'descending'):'none'}"><button class="sort-header ${selected?'sorted':''}" data-action="sort" data-value="${field}" aria-label="${hint}" title="${hint}">${label}<span aria-hidden="true">${selected?(direction==='desc'?'↓':'↑'):'↕'}</span></button></th>`;
  }
  function queriedRows() {
    const all=rowsFor(state.type),scope=state.exactFile||(state.searchScope==='all'?'':state.directory);
    const scopeRows=all.filter(r=>state.exactFile?r.path===state.exactFile:inDirectory(r.path,scope));
    const q=state.query.trim().toLowerCase();
    const candidates=scopeRows.filter(r=>(!q||`${r.path} ${r.name}`.toLowerCase().includes(q))&&matchesNumber(r));
    const rows=candidates.filter(r=>matchesStatus(r));
    rows.sort((a,b)=>{
      const [field,direction]=state.sort.split(':');
      if(field==='path') {
        const identity=row=>sortIdentity()==='名称'?`${row.name}/${row.path}`:row.path;
        return identity(a).localeCompare(identity(b))*(direction==='asc'?1:-1);
      }
      if(a[field]==null&&b[field]==null)return a.path.localeCompare(b.path);if(a[field]==null)return 1;if(b[field]==null)return -1;
      return (a[field]-b[field])*(direction==='asc'?1:-1)||a.path.localeCompare(b.path);
    });
    return {rows,candidates,allCount:all.length,scopeCount:scopeRows.length,exceptions:scopeRows.filter(hasException),scope};
  }
  function aggregate(dir,type) {
    const result={};
    for(const side of ['baseline','current']) {
      const s=model.sides[side];
      const vals=['methodLines','cc'].includes(type)?s.methods.filter(m=>inDirectory(m.path,dir)).map(m=>m[type==='cc'?'cyclomatic_complexity':'nbnc_loc']):Object.entries(s.files).filter(([p])=>inDirectory(p,dir)&&(type!=='sourceDuplication'||!isHeader(p))).map(([,v])=>v[type==='duplication'||type==='sourceDuplication'?2:0]);
      result[side]={value:vals.some(v=>v==null)?null:total(vals,v=>v),valid:vals.filter(v=>v!=null).length,count:vals.length};
    }
    return {...result,delta:knownDelta(result.baseline.value,result.current.value)};
  }
  function summaryStatus(key) {
    if(!model.limited)return '';
    if(['code_size','lines_per_file','unsafe_functions_kloc','redundant_code_kloc'].includes(key))return '汇总不一致';
    if(key.includes('code_duplication'))return '部分数据未知';
    if(key.startsWith('huge_cyclomatic'))return '阈值变化';
    if(key.startsWith('huge_folder'))return '成员不完整';
    return '';
  }
  function metricCard([key,unit,type]) {
    const b=model.sides.baseline.summary[key],c=model.sides.current.summary[key],d=knownDelta(b,c),issue=summaryStatus(key),t=thresholdKey(type)?transition(type):null;
    const highlight=t?t.entered>0&&!t.limited:d>0&&!issue;
    return `<button class="metric-card ${highlight?'has-growth':''}" data-action="metric" data-value="${type}" data-metric="${key}" ${t?`data-status="${t.limited?'all':'entered'}"`:''} title="${esc(metricName(key))}：${fmt(b,decimalMetric(key))} → ${fmt(c,decimalMetric(key))}；变化 ${deltaText(d,decimalMetric(key))}${unit==='%'?' 个百分点':''}${issue?`；${issue}`:''}"><span class="metric-name">${esc(metricName(key))}<span class="card-arrow">↗</span></span><div class="metric-delta ${highlight?'up':issue?'muted':cls(d)}">${t?`<small>新增</small> ${t.limited?'—':t.entered}`:deltaText(d,decimalMetric(key))}${!t?`<small>${unit==='%'?'百分点':unit}</small>`:''}</div><div class="metric-bottom"><span>基线 <b>${fmt(b,decimalMetric(key))}${unit==='%'?'%':''}</b><span class="arrow-sep">→</span>当前 <b>${fmt(c,decimalMetric(key))}${unit==='%'?'%':''}</b></span>${t?`<span>退出 ${t.limited?'—':t.exited}</span>`:''}</div>${issue?`<div class="metric-warning">${esc(issue)}</div>`:''}</button>`;
  }
  function comparisonHeader() {
    return `<div class="comparison"><span class="repo">${esc(DATA.meta.identities.current.repository)}</span><span>基线 <b>${esc(DATA.meta.identities.baseline.version)}</b></span><span>→</span><span>当前 <b>${esc(DATA.meta.identities.current.version)}</b></span><span class="spacer"></span><span>${fmt(model.sides.current.summary.files_total)} 文件 / ${fmt(model.sides.current.summary.methods_total)} 函数</span></div>`;
  }
  function chart() {
    const dirs=model.dirs.filter(d=>d==='include'||/^src\/[^/]+$/.test(d));
    const rows=dirs.map(path=>({path,file:false,...aggregate(path,'code')}));
    for(const file of model.fileRows.filter(r=>!dirs.some(dir=>inDirectory(r.path,dir))))rows.push({path:file.path,file:true,...aggregate(file.path,'code')});
    rows.sort((a,b)=>(b.delta??-Infinity)-(a.delta??-Infinity));
    const maximum=Math.max(1,...rows.map(r=>Math.abs(r.delta??0)));
    return `<div class="panel-head"><h2>目录代码行变化</h2><span class="muted small">${metricName('code_size')}</span></div>${rows.map(r=>`<div class="chart-row"><button data-action="${r.file?'open-file':'directory'}" data-value="${esc(r.path)}" data-type="code">${esc(r.path)}</button><div class="bar-track">${r.delta?`<span class="bar ${r.delta<0?'negative':'positive'}" style="width:${Math.abs(r.delta)/maximum*49}%"></span>`:''}</div><span class="number ${cls(r.delta)}">${deltaText(r.delta)}</span></div>`).join('')}`;
  }
  function overview() {
    const growth=rowsFor('code').filter(r=>r.delta>0).sort((a,b)=>b.delta-a.delta);
    return `${comparisonHeader()}<div class="section-head"><h1>概览</h1><span class="color-key"><i></i>增长 / 新增</span></div><div class="metrics-grid">${mainMetrics.slice(0,4).map(metricCard).join('')}</div><div class="section-head"><h2>新增超限</h2><span class="muted small">${mainMetrics.slice(8).filter(m=>{const t=transition(m[2]);return t.entered>0&&!t.limited;}).length} 类指标有新增</span></div><div class="metrics-grid threshold-grid">${mainMetrics.slice(8).map(metricCard).join('')}</div><div class="section-head"><h2>重复与问题</h2></div><div class="metrics-grid">${mainMetrics.slice(4,8).map(metricCard).join('')}</div><div class="overview-grid"><section class="panel">${chart()}</section><section class="panel"><div class="panel-head"><h2>文件代码行增长</h2><button class="text" data-action="growth-files">全部 ${growth.length} 个 ↗</button></div><table><thead><tr><th>文件</th><th class="num">基线</th><th class="num">当前</th><th class="num">增长</th></tr></thead><tbody>${growth.slice(0,8).map(r=>`<tr><td><button class="row-title mono" data-action="open-file" data-value="${esc(r.path)}" data-type="code">${esc(r.path)}</button></td><td class="num">${fmt(r.b)}</td><td class="num">${fmt(r.c)}</td><td class="num up">${deltaText(r.delta)}</td></tr>`).join('')}</tbody></table></section></div>`;
  }
  function tree() {
    return `<div class="panel-head"><h3>目录</h3><span class="small muted" title="当前文件数，包含子目录中的文件；可分析两次扫描的路径并集">当前文件</span></div><div class="directory-tree">${model.dirs.map(dir=>`<button data-action="directory" data-value="${esc(dir)}" class="${state.directory===dir?'active':''}" style="padding-left:${8+(dir?dir.split('/').length-1:0)*10}px"><span class="folder-icon">${dir?'▱':'▦'}</span><span>${esc(dir?dir.split('/').pop():'全部')}</span><span class="tree-count">${Object.keys(model.sides.current.files).filter(path=>inDirectory(path,dir)).length}</span></button>`).join('')}</div>`;
  }
  function queryNoun() {
    if(['cc','hugeCC','methodLines','hugeMethod'].includes(state.type))return '函数';
    if(state.type==='unsafe')return '调用位置';
    if(state.type==='redundant')return '代码块';
    return state.type==='folders'?'目录':'文件';
  }
  function emptyQuery(q) {
    if(!q.scopeCount)return '<tr><td colspan="5" class="empty">本范围无记录</td></tr>';
    const message=!state.query&&!state.numberFilter&&state.status==='changes'?'本范围无变化':'无匹配结果';
    return `<tr><td colspan="5" class="empty">${message}<br><button class="text" data-action="show-all">查看本范围全部 ${q.scopeCount} 项</button></td></tr>`;
  }
  function controls(q) {
    const options=statusOptions(),hasConditions=state.query||state.numberFilter||state.status!=='changes'||state.sort!=='delta:desc';
    const condition=state.numberFilter||{field:'c',operator:'gte',value:'',upper:''},{unit}=numberMeasure();
    return `<div class="query-controls"><form id="query-form" role="search"><input class="search" name="query" aria-label="搜索路径或名称" placeholder="输入路径或名称，即时查找" value="${esc(state.query)}">${state.query?'<button type="button" class="text" data-action="clear-search">清空搜索</button>':''}</form><div class="query-tabs" role="group" aria-label="查看哪类变化">${options.map(([value,label])=>`<button data-action="status" data-value="${value}" aria-pressed="${state.status===value}" class="${state.status===value?'active':''}">${label}<span>${q.candidates.filter(row=>matchesStatus(row,value)).length}</span></button>`).join('')}</div><div class="query-tools">${!existenceType()?`<button class="text" data-action="edit-number">${state.numberFilter?'修改数值条件':'数值条件'}</button>`:''}<span class="spacer"></span>${hasConditions?'<button class="text" data-action="reset">恢复默认</button>':''}</div>${state.numberFilter?`<div class="applied-conditions"><span>${esc(numberDescription())}</span><button class="text" data-action="clear-number" aria-label="移除数值条件">×</button></div>`:''}${state.numberEditor?`<form id="number-form" class="number-editor"><div class="number-sentence"><span>只看</span><select name="field" aria-label="筛选的度量">${numberFields().map(([field,label])=>`<option value="${field}" ${field===condition.field?'selected':''}>${label}</option>`).join('')}</select><select name="operator" data-change="numberOperator" aria-label="数值要求">${[['gte','至少'],['lte','不超过'],['between','介于']].map(([value,label])=>`<option value="${value}" ${value===condition.operator?'selected':''}>${label}</option>`).join('')}</select><input name="value" type="number" min="0" step="any" required aria-label="数量" placeholder="输入数量" value="${condition.value}"><span class="number-upper" ${condition.operator==='between'?'':'hidden'}>到 <input name="upper" type="number" min="0" step="any" ${condition.operator==='between'?'required':''} aria-label="区间终点" placeholder="输入数量" value="${condition.upper??''}"></span><span>${unit}</span></div><div class="row"><button type="submit" class="primary">应用条件</button><button type="button" data-action="cancel-number">取消</button></div></form>`:''}${q.exceptions.length?`<div class="query-warning"><button class="text" data-action="exceptions" aria-pressed="${state.status==='exceptions'}">数据异常 ${q.exceptions.length} 项</button><span>当前结果中 ${q.rows.filter(hasException).length} 项</span></div>`:''}<div class="query-summary" aria-live="polite"><span>${state.status==='exceptions'?'数据异常':options.find(([value])=>value===state.status)?.[1]||statusNames[state.status]} · 找到 ${q.rows.length} 项（本范围共 ${q.scopeCount} 项）</span><span>排序：${sortDescription()}</span></div></div>`;
  }
  function table() {
    const q=queriedRows(),pages=Math.max(1,Math.ceil(q.rows.length/state.pageSize));state.page=Math.min(state.page,pages);
    const slice=q.rows.slice((state.page-1)*state.pageSize,state.page*state.pageSize),key=thresholdKey(state.type);
    const additive=['code','duplication','sourceDuplication','methodLines','cc'].includes(state.type),scope=additive?aggregate(q.scope,state.type):null;
    const detailLabel={code:'文件代码行',duplication:'重复代码行',sourceDuplication:'源代码重复行',methodLines:'函数代码行',cc:'圈复杂度'}[state.type];
    const measure=state.type==='folders'?'直接成员数':state.type==='hugeCC'?'圈复杂度':'代码行数';
    const baselineLimit=model.sides.baseline.summary.huge_threshold[key],currentLimit=model.sides.current.summary.huge_threshold[key];
    const thresholdText=baselineLimit===currentLimit?`超限条件：${measure} &gt; <b>${baselineLimit}</b>`:`超限条件：基线 ${measure} &gt; <b>${baselineLimit}</b> · 当前 &gt; <b>${currentLimit}</b> ${badge('阈值不同','warning')}`;
    return `<div class="scope-title"><div><small>查找范围</small><strong>${esc(q.scope||'全部目录')}${q.scope&&!state.exactFile?' / 含子目录':''}</strong></div><span class="spacer"></span></div>${controls(q)}${key?`<div class="threshold-note">${thresholdText}</div>`:''}${scope?`<div class="scope-total" title="当前目录完整数据，不受表内筛选影响${['cc','methodLines'].includes(state.type)?'；同名函数按两侧原始值各自求和':''}"><span>完整范围 · ${detailLabel}合计</span><b>${fmt(scope.baseline.value)}</b><span>→</span><b>${fmt(scope.current.value)}</b><span class="${cls(scope.delta)}">${deltaText(scope.delta)}</span>${scope.current.valid!==scope.current.count?badge(`${scope.current.valid}/${scope.current.count} 有效`,'warning'):''}</div>`:''}<div class="table-wrap"><table class="data-table"><thead><tr>${sortHeader('path',queryNoun())}${existenceType()?'<th class="num">基线</th><th class="num">当前</th>':`${sortHeader('b',`基线${typeUnits[state.type]?` / ${typeUnits[state.type]}`:''}`,true)}${sortHeader('c',`当前${typeUnits[state.type]?` / ${typeUnits[state.type]}`:''}`,true)}`}${sortHeader('delta','变化',true)}<th>标记</th></tr></thead><tbody>${slice.length?slice.map(row=>`<tr class="${state.selected===row.id?'selected':''}"><td><button class="row-title ${row.kind==='file'||row.kind==='folder'?'mono':''}" data-action="select" data-value="${esc(row.id)}">${esc(row.kind==='file'||row.kind==='folder'?row.path:row.name)}</button>${row.kind==='method'?`<span class="row-subtitle mono">${esc(row.path)}</span>`:['unsafe','redundant'].includes(row.kind)?`<span class="row-subtitle mono">${esc(row.path)} : ${row.line}</span>`:row.kind==='folder'?`<span class="row-subtitle"><span class="${row.addedMembers?'up':''}">新增 ${row.addedMembers}</span> / 移出 ${row.removedMembers}</span>`:''}</td><td class="num">${row.ambiguous?`${row.before.length} 条`:existenceType()?(row.b?'有记录':'无记录'):fmt(row.b)}</td><td class="num">${row.ambiguous?`${row.after.length} 条`:existenceType()?(row.c?'有记录':'无记录'):fmt(row.c)}</td><td class="num ${row.flags.includes('incomparable')?'muted':cls(row.delta)}">${existenceType()?(row.delta>0?'新增':row.delta<0?'消失':'无变化'):deltaText(row.delta)}</td><td><div class="status-list">${rowStatus(row)}</div></td></tr>`).join(''):emptyQuery(q)}</tbody></table></div><div class="pagination"><span>${q.rows.length} 项</span><div class="row"><button data-action="page" data-value="-1" ${state.page===1?'disabled':''} aria-label="上一页">←</button><span>${state.page} / ${pages}</span><button data-action="page" data-value="1" ${state.page===pages?'disabled':''} aria-label="下一页">→</button></div></div>`;
  }
  function positionText(path,line,side,name='') {
    return `${side}：${path}:${line}${name?`（${name}）`:''}`;
  }
  function locationText(row) {
    const side=row.after&&(row.kind==='method'?row.after.length:true)?'当前':'基线';
    if(row.kind==='method') {
      if(row.ambiguous)return `${row.path}（${row.name}；同名函数无法配对）`;
      const m=row.after[0]||row.before[0];return positionText(row.path,m.start_line,side,row.name);
    }
    if(['unsafe','redundant'].includes(row.kind))return positionText(row.path,row.line,side,row.name);
    return row.path;
  }
  function copyBlock(row) {
    return `<div class="copy-block"><button class="text" data-action="copy">复制定位信息</button><details ${state.locationOverride?'open':''}><summary>定位文本</summary><textarea id="location-text" readonly aria-label="定位文本">${esc(state.locationOverride||locationText(row))}</textarea></details></div>`;
  }
  function groupPanel(path,side) {
    const groups=model.sides[side].groups.filter(g=>g.members.some(m=>m.path===path));
    const active=groups.find(g=>g.id===state.groups[side])||groups[0];state.groups[side]=active?.id??null;
    return `<section class="group-side"><div class="panel-head"><h3>${side==='baseline'?'基线':'当前'}</h3><span class="muted small">${groups.length} 组</span></div>${groups.length?`<div class="group-tabs">${groups.map(g=>`<button data-action="group" data-side="${side}" data-value="${esc(g.id)}" class="${g.id===active.id?'active':''}" title="${esc(g.id)}">组 ${esc(g.id.replace(/^code_duplication_/,''))}<span>${g.members.length} 片段</span></button>`).join('')}</div><div class="fragment-list">${active.members.map(m=>{
      const loc=positionText(m.path,m.start_line,side==='baseline'?'基线':'当前');
      return `<div class="fragment ${m.path===path?'anchor':''}"><div class="row"><strong class="mono">${esc(m.path)}</strong>${m.path===path?badge('当前文件','teal'):''}</div><div class="fragment-values"><span>起始行 <b>${m.start_line}</b></span><span title="有效重复代码行数，不是物理结束行">重复行 <b>${m.code_duplication}</b></span><button class="text" data-action="fragment" data-value="${esc(loc)}">复制位置</button></div></div>`;
    }).join('')}</div>`:'<div class="empty">无关联片段</div>'}</section>`;
  }
  function duplicationEvidence(row) {
    const peers=new Set();for(const side of ['baseline','current'])for(const group of model.sides[side].groups.filter(g=>g.members.some(m=>m.path===row.path)))for(const m of group.members)peers.add(m.path);
    peers.delete(row.path);
    return `<div class="evidence-section"><div class="panel-head"><h3>关联文件</h3><span class="small muted">${peers.size} 个</span></div>${peers.size?`<table class="peer-table"><thead><tr><th>文件</th><th class="num">基线重复行</th><th class="num">当前重复行</th><th class="num">变化</th></tr></thead><tbody>${[...peers].map(path=>{const before=model.sides.baseline.files[path],after=model.sides.current.files[path],b=before?before[2]:0,c=after?after[2]:0;return `<tr><td><button class="row-title mono" data-action="peer" data-value="${esc(path)}">${esc(path)}</button></td><td class="num">${fmt(b)}</td><td class="num">${fmt(c)}</td><td class="num ${cls(knownDelta(b,c))}">${deltaText(knownDelta(b,c))}</td></tr>`;}).join('')}</tbody></table>`:'<p class="muted">无其他关联文件</p>'}</div><div class="evidence-section"><div class="panel-head"><h3>重复片段</h3><span class="small muted" title="不依据组号或片段位置推断跨版本组身份">组号仅在各版本内有效</span></div><div class="group-columns">${groupPanel(row.path,'baseline')}${groupPanel(row.path,'current')}</div></div>`;
  }
  function folderEvidence(row) {
    const all=memberChanges(row.path),counts={entered:all.filter(m=>m.status==='entered').length,exited:all.filter(m=>m.status==='exited').length,same:all.filter(m=>m.status==='same').length};
    const filtered=all.filter(m=>(state.memberStatus==='all'||state.memberStatus==='changes'&&m.status!=='same'||m.status===state.memberStatus)&&m.name.toLowerCase().includes(state.memberQuery.toLowerCase()));
    const pages=Math.max(1,Math.ceil(filtered.length/12));state.memberPage=Math.min(state.memberPage,pages);const slice=filtered.slice((state.memberPage-1)*12,state.memberPage*12);
    const mismatches=['baseline','current'].filter(side=>model.sides[side].folders[row.path]!=null&&model.sides[side].folders[row.path]!==directMembers(side,row.path).length);
    return `<div class="evidence-section"><div class="member-summary"><span class="up"><strong>+${counts.entered}</strong> 新增</span><span class="down"><strong>−${counts.exited}</strong> 移出</span><span><strong>${counts.same}</strong> 未变</span></div>${mismatches.map(side=>`<div class="notice">${side==='baseline'?'基线':'当前'}计数 ${model.sides[side].folders[row.path]}，可见成员 ${directMembers(side,row.path).length}；成员不完整。</div>`).join('')}<div class="panel-head"><h3>直接成员</h3><span class="small muted" title="仅扫描可见成员；新增、移出不等同于磁盘创建、删除">扫描范围</span></div><div class="member-tabs">${[['changes',`变化 ${counts.entered+counts.exited}`],['entered',`新增 ${counts.entered}`],['exited',`移出 ${counts.exited}`],['all',`全部 ${all.length}`]].map(([value,label])=>`<button data-action="member-filter" data-value="${value}" class="${state.memberStatus===value?'active':''}">${label}</button>`).join('')}</div><input class="member-search" data-change="memberQuery" aria-label="搜索直接成员" placeholder="搜索成员名称，按 Enter" value="${esc(state.memberQuery)}"><table class="member-table"><thead><tr><th>名称</th><th>类型</th><th class="num">基线</th><th class="num">当前</th><th>变化</th></tr></thead><tbody>${slice.length?slice.map(m=>`<tr><td><button class="row-title mono" data-action="member-open" data-value="${esc(m.path)}" data-kind="${m.type}">${esc(m.name)}${m.type==='目录'?'/':''}</button></td><td>${m.type}</td><td class="num">${m.before?'✓':'—'}</td><td class="num">${m.after?'✓':'—'}</td><td>${m.status==='entered'?badge('新增','growth'):m.status==='exited'?badge('移出','decrease'):''}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">无匹配成员</td></tr>'}</tbody></table><div class="pagination"><span>${filtered.length} 个成员</span><div class="row"><button data-action="member-page" data-value="-1" ${state.memberPage===1?'disabled':''}>←</button><span>${state.memberPage} / ${pages}</span><button data-action="member-page" data-value="1" ${state.memberPage===pages?'disabled':''}>→</button></div></div></div>`;
  }
  function evidence() {
    const row=rowsFor(state.type).find(r=>r.id===state.selected);
    if(!row)return `<div class="empty">${state.trail.length?'<p>无关联记录</p><button class="text" data-action="back">← 返回原对象</button>':'选择左侧对象'}</div>`;
    let content='';
    if(row.kind==='file') {
      if(['duplication','sourceDuplication'].includes(state.type))content+=duplicationEvidence(row);
      else if(['dupfiles','sourceDupfiles'].includes(state.type))content+=`<div class="group-columns">${['baseline','current'].map(side=>`<section class="group-side"><h3>${side==='baseline'?'基线':'当前'}</h3>${model.sides[side].dupfiles.filter(g=>g.members.includes(row.path)).map(g=>`<div class="raw-row"><span class="muted">组 ${esc(g.id)}</span>${g.members.map(path=>`<p class="mono">${esc(path)}</p>`).join('')}</div>`).join('')||'<p class="muted">无重复文件</p>'}</section>`).join('')}</div>`;
      else content+=`<div class="evidence-section"><table><thead><tr><th>指标</th><th class="num">基线</th><th class="num">当前</th></tr></thead><tbody>${['code_size','raw_lines','code_duplication_total'].map((key,i)=>`<tr><td>${metricName(key)}</td><td class="num">${row.before?fmt(row.before[i]):'—'}</td><td class="num">${row.after?fmt(row.after[i]):'—'}</td></tr>`).join('')}</tbody></table></div>`;
      content+=`<div class="file-actions">${[['cc','函数'],['duplication','重复片段'],['unsafe',metricName('unsafe_functions_total')],['redundant',metricName('redundant_code_total')],['dupfiles',metricName('file_duplication_total')]].filter(([type])=>type!==state.type).map(([type,label])=>`<button data-action="related" data-value="${type}" data-path="${esc(row.path)}">${label} ↗</button>`).join('')}</div>`;
    } else if(row.kind==='method') {
      if(row.ambiguous)content+='<div class="notice">同文件同名，无法确定配对；不计算逐函数变化。</div>';
      for(const [side,items] of [['基线',row.before],['当前',row.after]])content+=`<div class="evidence-section"><h3>${side} / ${items.length} 条</h3>${items.map(m=>`<div class="raw-row"><strong class="mono">${esc(m.method_name)}</strong><span class="muted"> L${m.start_line}–${m.end_line}</span><p>代码行 <b>${m.nbnc_loc}</b> / 圈复杂度 <b>${m.cyclomatic_complexity}</b></p><button class="text" data-action="fragment" data-value="${esc(positionText(row.path,m.start_line,side,row.name))}">复制位置</button></div>`).join('')||'<p class="muted">无记录</p>'}</div>`;
    } else if(row.kind==='folder')content+=folderEvidence(row);
    return `<div class="evidence"><div class="evidence-head"><div class="row between"><h2 class="object-path mono">${esc(row.kind==='method'?row.name:row.path)}</h2>${state.trail.length?'<button class="text" data-action="back">← 返回</button>':''}</div>${row.kind==='method'?`<p class="mono muted small">${esc(row.path)}</p>`:''}<div class="status-list">${rowStatus(row)}</div></div><div class="pair-values"><div><small>基线${typeUnits[state.type]?` / ${typeUnits[state.type]}`:''}</small><strong>${row.ambiguous?'无法配对':existenceType()?(row.b?'有记录':'无记录'):fmt(row.b)}</strong></div><span class="pair-arrow">→</span><div><small>当前${typeUnits[state.type]?` / ${typeUnits[state.type]}`:''}</small><strong>${row.ambiguous?'无法配对':existenceType()?(row.c?'有记录':'无记录'):fmt(row.c)}</strong></div><div class="pair-delta ${row.flags.includes('incomparable')?'muted':cls(row.delta)}"><small>变化</small><strong>${existenceType()?(row.delta>0?'新增':row.delta<0?'消失':'无变化'):deltaText(row.delta)}</strong></div></div>${content}${copyBlock(row)}</div>`;
  }
  function fractionObjects(side,scope,key) {
    const s=model.sides[side],[numerator,denominator]=metricFraction(key),objects=new Map(),issues=[];
    const type=analysisMetrics.find(([metric])=>metric===key)[1],threshold=thresholdKey(type),limit=s.summary.huge_threshold[threshold];
    const exceeds=value=>Number.isFinite(value)&&Number.isFinite(limit)?Number(value>limit):null;
    if(denominator==='methods_total') {
      for(const method of s.methods.filter(method=>inDirectory(method.path,scope))) {
        const item=objects.get(method.path)||{numerator:0,denominator:0};
        const value=numerator==='method_lines'?method.nbnc_loc:numerator==='cyclomatic_complexity_total'?method.cyclomatic_complexity:exceeds(method[type==='hugeCC'?'cyclomatic_complexity':'nbnc_loc']);
        item.numerator=Number.isFinite(item.numerator)&&Number.isFinite(value)?item.numerator+value:null;
        item.denominator++;objects.set(method.path,item);
      }
    } else if(denominator==='folders_total') {
      const dirs=new Set(Object.keys(s.files).length?['']:[]);
      for(const path of Object.keys(s.files)){const parts=path.split('/');for(let i=1;i<parts.length;i++)dirs.add(parts.slice(0,i).join('/'));}
      const measured=new Map([...dirs].filter(path=>inDirectory(path,scope)).map(path=>[path,directMembers(side,path).length]));
      for(const [path,members] of measured)objects.set(path,{numerator:exceeds(members),denominator:1});
      const declared=Object.entries(s.folders).filter(([path])=>inDirectory(path,scope));
      if(declared.some(([path,members])=>members!==measured.get(path)||!(members>limit))||[...measured].some(([path,members])=>members>limit&&!(path in s.folders)))issues.push('目录成员或超限清单不完整');
    } else {
      const repeated=new Set(s.dupfiles.flatMap(group=>group.members));
      for(const [path,values] of Object.entries(s.files).filter(([path])=>inDirectory(path,scope))) {
        let amount;
        if(numerator==='code_size')amount=values[0];
        else if(numerator==='code_duplication_total'||numerator==='non_hfile_code_duplication_total')amount=numerator.startsWith('non_hfile')&&isHeader(path)?0:values[2];
        else if(numerator==='file_duplication_total'||numerator==='non_hfile_duplication_total')amount=Number(repeated.has(path)&&(!numerator.startsWith('non_hfile')||!isHeader(path)));
        else amount=(type==='hugeHeader'?isHeader(path):!isHeader(path))?exceeds(values[0]):0;
        objects.set(path,{numerator:amount,denominator:denominator==='code_size'?values[0]:1});
      }
    }
    return {objects,issues};
  }
  function fractionChange(scope,key) {
    const rows=model.fileRows.filter(row=>inDirectory(row.path,scope)),sides={},sets={},issues=[];
    const [numerator,denominator]=metricFraction(key),ratio=key.endsWith('_ratio'),scale=ratio?100:1;
    const type=analysisMetrics.find(([metric])=>metric===key)[1],threshold=thresholdKey(type);
    const sumKnown=values=>values.every(Number.isFinite)?total(values,value=>value):null;
    if(threshold) {
      const limits=['baseline','current'].map(side=>model.sides[side].summary.huge_threshold[threshold]);
      if(limits.some(limit=>!Number.isFinite(limit)))issues.push('超限阈值未知');
      else if(limits[0]!==limits[1])issues.push('超限阈值变化，不可直接比较');
    }
    for(const side of ['baseline','current']) {
      const label=side==='baseline'?'基线':'当前',summary=model.sides[side].summary;
      const measured=fractionObjects(side,scope,key);sets[side]=measured.objects;issues.push(...measured.issues.map(issue=>`${label}${issue}`));
      const values=[...measured.objects.values()],amount=sumKnown(values.map(item=>item.numerator)),count=sumKnown(values.map(item=>item.denominator));
      const detail={numerator:amount,denominator:count,value:amount!=null&&count>0?amount/count*scale:null};
      const shown=scope?detail:{numerator:summary[numerator],denominator:summary[denominator],value:summary[key]};
      sides[side]=shown;
      if(!Number.isFinite(amount)||!Number.isFinite(count)||!Number.isFinite(shown.numerator)||!Number.isFinite(shown.denominator))issues.push(`${label}数据未知`);
      else if(shown.denominator===0)issues.push(`${label}${metricName(denominator)}为零，${ratio?'比例':'均值'}不适用`);
      else if(!Number.isFinite(shown.value))issues.push(`${label}${ratio?'比例':'均值'}未知`);
      else if(!scope&&(shown.numerator!==amount||shown.denominator!==count||detail.value==null||Math.abs(shown.value-detail.value)>1e-6))issues.push(`${label}汇总与明细不一致`);
    }
    const continuing=rows.filter(row=>row.before&&row.after),added=rows.filter(row=>!row.before&&row.after),removed=rows.filter(row=>row.before&&!row.after);
    const members=[
      {label:'存续文件',count:continuing.length,lines:sumKnown(continuing.map(row=>Number.isFinite(row.before[0])&&Number.isFinite(row.after[0])?row.after[0]-row.before[0]:null))},
      {label:'新增文件',count:added.length,lines:sumKnown(added.map(row=>row.after[0]))},
      {label:'移出文件',count:removed.length,lines:sumKnown(removed.map(row=>Number.isFinite(row.before[0])?-row.before[0]:null))}
    ];
    const b=sides.baseline,c=sides.current;
    // 固定顺序的算术分解；对象贡献相加等于整体变化，不据此推断业务因果。
    const effects=issues.length?null:{numerator:(c.numerator-b.numerator)/b.denominator*scale,denominator:c.numerator*(b.denominator-c.denominator)/(b.denominator*c.denominator)*scale,delta:(c.numerator/c.denominator-b.numerator/b.denominator)*scale};
    const contributions=effects?union(sets.baseline.keys(),sets.current.keys()).map(path=>{
      const before=sets.baseline.get(path)||{numerator:0,denominator:0},after=sets.current.get(path)||{numerator:0,denominator:0};
      const n=(after.numerator-before.numerator)/b.denominator*scale,d=c.numerator*(before.denominator-after.denominator)/(b.denominator*c.denominator)*scale;
      return {path,numerator:n,denominator:d,value:n+d,before,after};
    }).filter(item=>item.numerator!==0||item.denominator!==0).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)||Math.abs(b.numerator)+Math.abs(b.denominator)-Math.abs(a.numerator)-Math.abs(a.denominator)||a.path.localeCompare(b.path)):[];
    const transitions=threshold?rowsFor(type).filter(row=>inDirectory(row.path,scope)):[];
    return {...sides,members,issues,effects,contributions,numerator,denominator,ratio,threshold,transitions:{limited:issues.length>0||transitions.some(row=>row.ambiguous||row.flags.includes('incomparable')||row.flags.includes('unknown')),entered:transitions.filter(row=>row.flags.includes('entered')).length,exited:transitions.filter(row=>row.flags.includes('exited')).length}};
  }
  function contributionTable(change,unit) {
    const items=change.contributions,pages=Math.max(1,Math.ceil(items.length/5));state.contributionPage=Math.min(state.contributionPage,pages);
    const shown=items.slice((state.contributionPage-1)*5,state.contributionPage*5),folder=change.denominator==='folders_total';
    return `<div class="fraction-contributions"><div class="panel-head"><h3>${folder?'目录':'文件'}贡献</h3><span class="small muted">按合计影响排序 / ${unit}</span></div><div class="table-wrap"><table class="contribution-table"><thead><tr><th>${folder?'目录':'文件'}</th><th class="num" title="${esc(metricName(change.numerator))}变化带来的贡献">分子</th><th class="num" title="${esc(metricName(change.denominator))}变化带来的贡献">分母</th><th class="num">合计</th></tr></thead><tbody>${shown.length?shown.map(item=>`<tr><td><button class="row-title mono" data-action="contributor" data-kind="${folder?'folder':'file'}" data-value="${esc(item.path)}" title="${esc(item.path||'项目根目录')}">${esc(item.path||'项目根目录')}</button></td><td class="num ${cls(item.numerator)}">${deltaText(item.numerator,true)}</td><td class="num ${cls(item.denominator)}">${deltaText(item.denominator,true)}</td><td class="num ${cls(item.value)}">${deltaText(item.value,true)}</td></tr>`).join(''):`<tr><td colspan="4" class="empty">${change.issues.length?'数据不可比较，无法计算贡献':'分子与分母均无变化'}</td></tr>`}</tbody></table></div><div class="pagination"><span>${change.issues.length?'贡献未计算':`${items.length} 个${folder?'目录':'文件'}`}</span><div class="row"><button data-action="contribution-page" data-value="-1" ${state.contributionPage===1?'disabled':''} aria-label="贡献上一页">←</button><span>${state.contributionPage} / ${pages}</span><button data-action="contribution-page" data-value="1" ${state.contributionPage===pages?'disabled':''} aria-label="贡献下一页">→</button></div></div></div>`;
  }
  function metricExplanation() {
    if(!metricFraction(state.metric))return '';
    const scope=state.searchScope==='all'?'':state.directory,change=fractionChange(scope,state.metric),b=change.baseline,c=change.current,e=change.effects;
    const kind=change.ratio?'比例':'均值',unit=change.ratio?'个百分点':state.metric==='cyclomatic_complexity_per_method'?'复杂度 / 函数':state.metric==='lines_per_method'?'行 / 函数':'行 / 文件',t=change.transitions;
    const numeratorLabel=metricName(change.numerator),denominatorLabel=metricName(change.denominator);
    const numeratorUnit=['code_size','method_lines','code_duplication_total','non_hfile_code_duplication_total'].includes(change.numerator)?'行':change.numerator==='cyclomatic_complexity_total'?'复杂度':'个';
    const entries=[['numerator',numeratorLabel,numeratorUnit],['denominator',denominatorLabel,change.denominator==='code_size'?'行':'个'],['value',metricName(state.metric),change.ratio?'%':unit]];
    return `<section class="average-explanation panel" aria-label="${esc(metricName(state.metric))}变化"><div class="panel-head"><h2>${kind}变化与贡献</h2><span class="small muted average-scope" title="包含范围内全部对象，不受下方搜索、状态筛选或分页影响">${scope?`${esc(scope)} / 含子目录`:'全报告汇总'}</span></div><div class="average-layout"><div><div class="table-wrap"><table class="average-summary"><thead><tr><th>指标</th><th class="num">基线</th><th class="num">当前</th><th class="num">变化</th></tr></thead><tbody>${entries.map(([field,label,fieldUnit])=>`<tr><td>${esc(label)} <small class="muted">${fieldUnit}</small></td><td class="num">${fmt(b[field],field==='value')}${field==='value'&&change.ratio&&b[field]!=null?'%':''}</td><td class="num">${fmt(c[field],field==='value')}${field==='value'&&change.ratio&&c[field]!=null?'%':''}</td><td class="num ${change.issues.length?'muted':cls(knownDelta(b[field],c[field]))}">${deltaText(knownDelta(b[field],c[field]),field==='value')}${field==='value'&&change.ratio?' 个百分点':''}</td></tr>`).join('')}</tbody></table></div>${change.threshold?`<div class="average-members"><span>新增超限 <b class="${t.entered&&!t.limited?'up':''}">${t.limited?'—':t.entered}</b></span><span>退出超限 <b>${t.limited?'—':t.exited}</b></span></div>`:state.metric==='lines_per_file'?`<div class="average-members" title="按两侧扫描路径集合识别，不等同于磁盘创建或删除">${change.members.map(m=>`<span>${m.label} <b>${m.count}</b><span class="${cls(m.lines)}">${deltaText(m.lines)} 行</span></span>`).join('')}</div>`:''}</div><div class="average-effects"><div class="panel-head"><h3>变化贡献</h3><span class="small muted">${unit}</span></div>${change.issues.length?`<div class="notice">${change.issues.map(esc).join('；')}，无法可靠拆分${kind}变化。</div>`:`<div class="average-effect"><span>${numeratorLabel}变化</span><strong class="${cls(e.numerator)}">${deltaText(e.numerator,true)}</strong></div><div class="average-effect"><span>${denominatorLabel}变化</span><strong class="${cls(e.denominator)}">${deltaText(e.denominator,true)}</strong></div><div class="average-effect total"><span>${kind}变化</span><strong class="${cls(e.delta)}">${deltaText(e.delta,true)}</strong></div>`}</div>${contributionTable(change,unit)}</div><details class="average-formula"><summary>计算口径</summary><p>${esc(metricName(state.metric))} = ${numeratorLabel} ÷ ${denominatorLabel}${change.ratio?' × 100%':''}。</p><p>先固定基线${denominatorLabel}，计算${numeratorLabel}变化的影响；再按当前${numeratorLabel}，计算${denominatorLabel}变化的影响。分子贡献按对象分子变化分配，分母贡献按对象分母变化分配；函数类指标按文件汇总。列表按合计贡献的绝对值排序，保留相互抵消的贡献。</p><p>两项贡献按原始值相加得到${kind}变化，各自四舍五入后显示值相加可能相差 0.01。${scope?`目录范围从两侧完整明细分别重算。${change.denominator==='folders_total'?'总目录数包含所选目录本身及其可见子目录。':''}`:'左侧保留报告汇总原值，贡献计算前核对明细。'}</p></details></section>`;
  }
  function workspace() {
    const key=state.metric,b=model.sides.baseline.summary[key],c=model.sides.current.summary[key],ratio=key.endsWith('_ratio'),fraction=metricFraction(key);
    const issue=summaryStatus(key)||(fraction&&['baseline','current'].some(side=>model.sides[side].summary[fraction[1]]===0)?'分母为零 / 不适用':'');
    const formula=fraction?['baseline','current'].map(side=>{const s=model.sides[side].summary;return `${side==='baseline'?'基线':'当前'}：${metricName(fraction[0])} ${fmt(s[fraction[0]])} ÷ ${metricName(fraction[1])} ${fmt(s[fraction[1]])}${ratio?' × 100%':''}`;}).join('；'):'';
    return `<div class="analysis-heading"><div class="row"><h1>分析</h1><span class="active-metric">${esc(metricName(key))}</span>${issue?badge(issue,'warning'):''}</div><div class="analysis-total" title="${esc(`全报告指标${formula?`；${formula}`:''}`)}"><span>基线 <b>${fmt(b,decimalMetric(key))}${ratio?'%':''}</b></span><span>→</span><span>当前 <b>${fmt(c,decimalMetric(key))}${ratio?'%':''}</b></span><b class="${issue?'muted':cls(knownDelta(b,c))}">${deltaText(knownDelta(b,c),decimalMetric(key))}${ratio?' 个百分点':''}</b></div></div><nav class="analysis-metrics panel" aria-label="分析指标">${analysisCategories.map(([label,metrics])=>`<div class="metric-category" role="group" aria-label="${label}"><h2>${label}</h2><div class="metric-options">${metrics.map(([metric])=>`<button type="button" data-action="analysis-type" data-value="${metric}" aria-pressed="${state.metric===metric}" class="${state.metric===metric?'active':''}">${esc(metricName(metric))}</button>`).join('')}</div></div>`).join('')}</nav>${metricExplanation()}<div class="analysis-grid ${['duplication','sourceDuplication','folders','dupfiles','sourceDupfiles'].includes(state.type)?'wide-evidence':''}"><aside class="panel tree-panel">${tree()}</aside><section class="panel table-panel">${table()}</section><aside class="panel evidence-panel">${evidence()}</aside></div>`;
  }
  function allMetrics() {
    const keys=Object.keys(model.sides.baseline.summary).filter(key=>typeof model.sides.baseline.summary[key]==='number');
    const ordered=[...mainMetrics.map(m=>m[0]),...keys.filter(key=>!mainMetrics.some(m=>m[0]===key))];
    return `${comparisonHeader()}<div class="section-head"><h1>全部指标</h1><span class="muted">${keys.length} 项</span></div><section class="panel"><table><thead><tr><th>指标</th><th class="num">基线</th><th class="num">当前</th><th class="num">变化</th><th>新增 / 退出</th></tr></thead><tbody>${ordered.map(key=>{
      const b=model.sides.baseline.summary[key],c=model.sides.current.summary[key],d=knownDelta(b,c),m=analysisMetrics.find(m=>m[0]===key),t=m&&thresholdKey(m[1])?transition(m[1]):null,issue=summaryStatus(key);
      return `<tr><td title="${esc(key)}">${m?`<button class="row-title" data-action="metric" data-value="${m[1]}" data-metric="${key}" ${t?`data-status="${t.limited?'all':'entered'}"`:''}>${esc(metricName(key))} ↗</button>`:esc(metricName(key))}${issue?badge(issue,'warning'):''}</td><td class="num">${fmt(b,decimalMetric(key))}${key.endsWith('_ratio')?'%':''}</td><td class="num">${fmt(c,decimalMetric(key))}${key.endsWith('_ratio')?'%':''}</td><td class="num ${issue?'muted':cls(d)}">${deltaText(d,decimalMetric(key))}${key.endsWith('_ratio')?' 个百分点':''}</td><td>${t?`<span class="${t.entered&&!t.limited?'up':''}">新增 ${t.limited?'—':t.entered}</span> / 退出 ${t.limited?'—':t.exited}`:''}</td></tr>`;
    }).join('')}<tr><td>最大函数代码行</td><td class="num">${fmt(DATA.baseline.detail_metrics.method_metrics.at(-1).maximum_nbnc_loc)}</td><td class="num">${fmt(DATA.current.detail_metrics.method_metrics.at(-1).maximum_nbnc_loc)}</td><td class="num">${deltaText(knownDelta(DATA.baseline.detail_metrics.method_metrics.at(-1).maximum_nbnc_loc,DATA.current.detail_metrics.method_metrics.at(-1).maximum_nbnc_loc))}</td><td></td></tr></tbody></table></section><details class="data-notes"><summary>数据说明与阈值</summary><div class="panel"><h3>超限阈值（严格大于）</h3><div class="threshold-list">${Object.entries(typeMetrics).filter(([type])=>thresholdKey(type)).map(([type,key])=>`<span>${metricName(key)} <b>${model.sides.baseline.summary.huge_threshold[thresholdKey(type)]} → ${model.sides.current.summary.huge_threshold[thresholdKey(type)]}</b></span>`).join('')}</div><p>同名无法配对：${model.methodRows.filter(r=>r.ambiguous).length} 组。原始记录保留，逐函数变化不计算。</p>${model.limited?'<p>异常演示：汇总不一致、重复行未知、阈值变化、目录成员不完整。</p>':''}<p>模拟数据，种子 ${DATA.meta.seed}。全部明细保留，搜索覆盖当前指标全部页；不含源码。</p><details><summary>来源字段与文件摘要</summary><pre>${esc(JSON.stringify({fields:DATA.meta.metricNames,sha256:DATA.meta.sha256},null,2))}</pre></details></div></details>`;
  }
  function inspector() {return PROTOTYPE_MODE?`<details class="state-inspector"><summary>原型状态</summary><pre>${esc(JSON.stringify({...state,result:queriedRows().rows.length,seed:DATA.meta.seed},null,2))}</pre></details>`:'';}
  function render() {
    $('#app').innerHTML=`<header class="app-header"><div class="brand"><span class="brand-mark"><i></i><i></i><i></i></span>Cmetrics</div><nav>${[['overview','概览'],['workspace','分析'],['metrics','全部指标']].map(([view,label])=>`<button data-action="view" data-value="${view}" class="${state.view===view?'active':''}">${label}</button>`).join('')}</nav><span class="spacer"></span><span class="prototype-label">模拟数据 / 原型</span><select aria-label="模拟数据场景" data-change="scenario"><option value="normal" ${state.scenario==='normal'?'selected':''}>标准样例</option><option value="limited" ${state.scenario==='limited'?'selected':''}>异常样例</option></select></header>${model.limited?'<div class="anomaly-banner">部分数据不可比较 <button class="text" data-action="view" data-value="metrics">查看异常 ↗</button></div>':''}<main class="${state.view==='workspace'?'analysis-page':'overview-page'}">${state.view==='workspace'?workspace():state.view==='metrics'?allMetrics():overview()}${inspector()}</main>`;
    document.documentElement.classList.add('interactive-ready');document.title='Cmetrics / 代码变化';
    console.info('[prototype state]',structuredClone(state));
  }
  function resetEvidence(){state.locationOverride=null;state.groups={baseline:null,current:null};state.memberStatus='changes';state.memberQuery='';state.memberPage=1;}
  function resetQuery(){Object.assign(state,{query:'',status:'changes',sort:'delta:desc',numberFilter:null,numberEditor:false,searchScope:'directory',page:1,selected:null,exactFile:null,contributionPage:1});resetEvidence();}
  function refreshQuery(){state.page=1;state.selected=null;state.trail=[];resetEvidence();selectInitial();safeRender();}
  function selectInitial(){const rows=queriedRows().rows;state.selected=(rows.find(r=>r.path==='src/core/parser.c'&&!r.ambiguous)||rows[0])?.id??null;}
  function remember(){const {trail,...context}=state;state.trail.push(structuredClone(context));}
  function openFile(path,type='code',retainTrail=false){if(retainTrail)remember();else state.trail=[];resetQuery();state.view='workspace';selectMetric(defaultMetric(type));state.directory='';state.query=path;state.searchScope='all';state.status='all';state.selected=`file:${path}`;syncURL();}
  function syncURL(){const url=new URL(location.href);url.searchParams.delete('variant');url.searchParams.set('view',state.view);history.replaceState(null,'',url);}
  function safeRender(){try{render();}catch(error){fail(error);}}
  function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');setTimeout(()=>$('#toast').classList.remove('visible'),2200);}
  async function copy(text){try{await navigator.clipboard.writeText(text);toast('已复制');}catch{const area=$('#location-text');if(area){area.closest('details').open=true;area.focus();area.select();}toast('请按 Ctrl/Cmd+C 复制');}}
  function fail(error){console.error(error);document.documentElement.classList.remove('interactive-ready');$('#app').innerHTML='';$('#init-status').textContent=`交互不可用，仅显示静态概览。${error.message}`;}
  document.addEventListener('click',async event=>{
    const target=event.target.closest('[data-action]');if(!target)return;const action=target.dataset.action,value=target.dataset.value;
    if(action==='copy'){await copy($('#location-text').value);return;}
    if(action==='fragment'){state.locationOverride=value;safeRender();await copy(value);return;}
    if(action==='group'){state.groups[target.dataset.side]=value;state.locationOverride=null;safeRender();return;}
    if(action==='contribution-page'){state.contributionPage+=Number(value);safeRender();return;}
    if(action==='member-filter'){state.memberStatus=value;state.memberPage=1;safeRender();return;}
    if(action==='member-page'){state.memberPage+=Number(value);safeRender();return;}
    if(action==='back'){const previous=state.trail.pop();if(previous){const trail=state.trail;state={...previous,trail};}safeRender();return;}
    if(action==='view'){state.view=value;if(value==='workspace'&&!state.selected)selectInitial();syncURL();}
    if(action==='page'){state.page+=Number(value);state.selected=null;resetEvidence();}
    if(action==='select'){state.selected=value;state.trail=[];resetEvidence();}
    if(action==='reset'){state.query='';state.status='changes';state.sort='delta:desc';state.numberFilter=null;state.numberEditor=false;state.page=1;state.selected=null;resetEvidence();selectInitial();}
    if(action==='show-all'){state.query='';state.status='all';state.numberFilter=null;state.numberEditor=false;refreshQuery();return;}
    if(action==='status'){state.status=value;if(state.sort.startsWith('delta:'))state.sort=`delta:${['decrease','exited'].includes(value)?'asc':'desc'}`;state.numberEditor=false;refreshQuery();return;}
    if(action==='exceptions'){state.status='exceptions';state.query='';state.numberFilter=null;state.numberEditor=false;refreshQuery();return;}
    if(action==='clear-search'){state.query='';refreshQuery();return;}
    if(action==='clear-number'){state.numberFilter=null;state.numberEditor=false;refreshQuery();return;}
    if(action==='edit-number'){state.numberEditor=true;safeRender();$('#number-form [name="value"]').focus();return;}
    if(action==='cancel-number'){state.numberEditor=false;safeRender();return;}
    if(action==='sort'){const [field,direction]=state.sort.split(':');state.sort=`${value}:${field===value?(direction==='desc'?'asc':'desc'):value==='path'?'asc':'desc'}`;state.numberEditor=false;refreshQuery();return;}
    if(action==='analysis-type'&&value===state.metric)return;
    if(action==='metric'||action==='analysis-type'){resetQuery();state.directory='';selectMetric(action==='analysis-type'?value:target.dataset.metric||defaultMetric(value));state.view='workspace';state.trail=[];if(target.dataset.status)state.status=target.dataset.status;selectInitial();syncURL();}
    if(action==='contributor'){
      remember();resetQuery();state.status='all';
      if(target.dataset.kind==='folder'){selectMetric('code_size');state.directory=value;}
      else{if(!rowsFor(state.type).some(row=>row.path===value))selectMetric('code_size');state.directory='';state.query=value;state.exactFile=value;state.searchScope='all';}
      selectInitial();syncURL();
    }
    if(action==='directory'){if(state.view!=='workspace')selectMetric('code_size');state.directory=value;state.view='workspace';state.trail=[];resetQuery();selectInitial();syncURL();}
    if(action==='growth-files'){resetQuery();state.directory='';selectMetric('code_size');state.status='growth';state.view='workspace';selectInitial();syncURL();}
    if(action==='open-file')openFile(value,target.dataset.type);
    if(action==='peer')openFile(value,state.type==='sourceDuplication'&&!isHeader(value)?'sourceDuplication':'duplication',true);
    if(action==='related'){remember();const path=target.dataset.path;resetQuery();selectMetric(defaultMetric(value));state.query=path;state.searchScope='all';state.status='all';selectInitial();}
    if(action==='member-open'){remember();resetQuery();selectMetric('code_size');state.status='all';if(target.dataset.kind==='目录'){state.directory=value;selectInitial();}else{state.directory='';state.query=value;state.selected=`file:${value}`;}}
    safeRender();
    if(action==='analysis-type')document.querySelector(`.analysis-metrics [data-value="${state.metric}"]`)?.focus({preventScroll:true});
    if(['view','metric','directory','growth-files','open-file'].includes(action))window.scrollTo(0,0);
  });
  document.addEventListener('input',event=>{
    if(event.target.form?.id==='number-form'){event.target.form.elements.upper.setCustomValidity('');return;}
    if(event.isComposing||event.target.name!=='query'||event.target.form?.id!=='query-form')return;
    const start=event.target.selectionStart,end=event.target.selectionEnd;
    state.query=event.target.value;state.numberEditor=false;
    if(state.exactFile&&state.query!==state.exactFile)state.exactFile=null;
    refreshQuery();const input=$('#query-form [name="query"]');input.focus();input.setSelectionRange(start,end);
  });
  document.addEventListener('change',event=>{
    const key=event.target.dataset.change;if(!key)return;
    if(key==='numberOperator'){const form=event.target.form,between=event.target.value==='between';form.querySelector('.number-upper').hidden=!between;form.elements.upper.required=between;form.elements.upper.setCustomValidity('');return;}
    if(key==='memberQuery'){state.memberQuery=event.target.value;state.memberPage=1;safeRender();return;}
    state[key]=event.target.value;state.page=1;state.selected=null;state.trail=[];resetEvidence();
    if(key==='scenario'){model=buildModel();resetQuery();}
    selectInitial();safeRender();
  });
  document.addEventListener('submit',event=>{
    if(event.target.id==='query-form'){event.preventDefault();return;}
    if(event.target.id!=='number-form')return;event.preventDefault();
    const form=event.target,data=new FormData(form),operator=String(data.get('operator')),value=Number(data.get('value')),upper=Number(data.get('upper'));
    if(operator==='between'&&upper<value){form.elements.upper.setCustomValidity('区间终点不能小于前面的数量');form.elements.upper.reportValidity();return;}
    state.numberFilter={field:String(data.get('field')),operator,value,...operator==='between'?{upper}:{}};state.numberEditor=false;state.status='all';if(state.sort.startsWith('delta:'))state.sort=`delta:${state.numberFilter.field==='decrease'?'asc':'desc'}`;refreshQuery();
  });
  window.addEventListener('popstate',()=>{const view=new URLSearchParams(location.search).get('view');state.view=['overview','workspace','metrics'].includes(view)?view:'overview';safeRender();});
  try {
    DATA=JSON.parse($('#report-data').textContent);
    const params=new URLSearchParams(location.search),view=params.get('view')||(params.get('variant')==='B'?'workspace':'overview');
    state={scenario:'normal',view:['overview','workspace','metrics'].includes(view)?view:'overview',type:'code',metric:'code_size',directory:'',query:'',searchScope:'directory',status:'changes',sort:'delta:desc',numberFilter:null,numberEditor:false,page:1,pageSize:10,selected:null,exactFile:null,locationOverride:null,groups:{baseline:null,current:null},memberStatus:'changes',memberQuery:'',memberPage:1,contributionPage:1,trail:[]};
    model=buildModel();selectInitial();if(params.get('failInit')==='1')throw new Error('模拟初始化失败');render();
  }catch(error){fail(error);}
})();
