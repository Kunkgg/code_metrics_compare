/* 净影响读取完整列；缓存完整排名，只向 UI 返回当前页。 */
const uiFractions={
  lines_per_file:['code_size','files_total','code'],lines_per_method:['method_lines','methods_total','methodLines'],cyclomatic_complexity_per_method:['cyclomatic_complexity_total','methods_total','cc'],
  code_duplication_ratio:['code_duplication_total','code_size','duplication'],file_duplication_ratio:['file_duplication_total','files_total','dupfiles'],
  non_hfile_code_duplication_ratio:['non_hfile_code_duplication_total','code_size','sourceDuplication'],non_hfile_duplication_ratio:['non_hfile_duplication_total','files_total','sourceDupfiles'],
  huge_headerfile_ratio:['huge_headerfile_total','files_total','hugeHeader'],huge_non_headerfile_ratio:['huge_non_headerfile_total','files_total','hugeSource'],
  huge_method_ratio:['huge_method_total','methods_total','hugeMethod'],huge_cyclomatic_complexity_ratio:['huge_cyclomatic_complexity_total','methods_total','hugeCC'],huge_folder_ratio:['huge_folder_total','folders_total','folders']
};
let uiImpactCache=null;
const uiImpactSum=values=>values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0):null;
// 报告可能保存精确值，也可能按业务规则保存两位 Half-Up 显示值。
function uiImpactSummaryMatches(reported,exact){
  if(!Number.isFinite(reported)||!Number.isFinite(exact))return false;
  return Math.abs(reported-exact)<=1e-10*Math.max(1,Math.abs(exact))||Math.abs(reported-Math.floor(exact*100+0.5)/100)<1e-10;
}
function uiImpactObjects(side,scope,key){
  const [numerator,denominator,type]=uiFractions[key],tag=side==='baseline'?'b':'c',objects=new Map(),issues=[];
  const threshold=uiThreshold(type),limit=threshold?uiContext.summaries[side].huge_threshold[threshold]:null;
  const exceeds=value=>Number.isFinite(value)&&Number.isFinite(limit)?Number(value>limit):null;
  const [lo,hi]=scopeRange(scope);
  if(denominator==='folders_total'){
    for(let i=0;i<S.dirs.length;i++){
      const d=S.dirs[i];if(scope&&d.p!==scope&&!d.p.startsWith(scope+'/')||!d[tag+'F'])continue;
      const members=uiMembers(d)[tag],declared=side==='current'&&uiContext.limitedFolder===i&&d.kC!=null?d.kC+3:d[side==='baseline'?'kB':'kC'];
      if(Number.isFinite(limit)&&(declared!=null&&(declared!==members||!(declared>limit))||declared==null&&members>limit))issues.push('目录成员或超限清单不完整');
      objects.set(d.p,{numerator:exceeds(members),denominator:1});
    }
  }else for(let f=lo;f<hi;f++){
    if(!S.files[tag+'Ex'][f])continue;
    let amount=0,count=1;
    if(denominator==='methods_total'){
      const data=(tag==='b'?S.mB:S.mC).views,range=tag==='b'?S.rangeB:S.rangeC,field=type==='cc'||type==='hugeCC'?'cc':'ln',bit=field==='cc'?2:1,values=[];
      for(let at=range[f];at<range[f+1];at++)values.push(data.valid&&!(data.valid[at]&bit)?null:threshold?exceeds(data[field][at]):data[field][at]);
      count=values.length;amount=uiImpactSum(values);
    }else{
      const sourceOnly=type==='sourceDuplication'||type==='sourceDupfiles',header=uiHeader(S.paths[f]);
      if(type==='code')amount=uiFileValue(f,'code',side);
      else if(type==='duplication'||type==='sourceDuplication')amount=sourceOnly&&header?0:uiFileValue(f,'duplication',side);
      else if(type==='dupfiles'||type==='sourceDupfiles')amount=sourceOnly&&header?0:S.dupMember[side][f];
      else amount=(type==='hugeHeader'?header:!header)?exceeds(uiFileValue(f,'code',side)):0;
      if(denominator==='code_size')count=uiFileValue(f,'code',side);
    }
    objects.set(S.paths[f],{numerator:amount,denominator:count});
  }
  return {objects,issues};
}
function uiImpact(state){
  const definition=uiFractions[state.metric];if(!definition)return null;
  const scope=state.searchScope==='all'?'':state.directory||'',cacheKey=JSON.stringify([uiContext.scenario,state.metric,scope]);
  if(uiImpactCache?.key!==cacheKey){
    const [numerator,denominator,type]=definition,ratio=state.metric.endsWith('_ratio'),scale=ratio?100:1,threshold=uiThreshold(type),issues=[...(uiContext.comparisonIssues||[])],sides={},sets={};
    if(threshold){
      const limits=['baseline','current'].map(side=>uiContext.summaries[side].huge_threshold[threshold]);
      if(!limits.every(Number.isFinite))issues.push('超限阈值未知');
      else if(limits[0]!==limits[1])issues.push('超限阈值变化，净影响分解暂不可用');
    }
    for(const side of ['baseline','current']){
      const measured=uiImpactObjects(side,scope,state.metric),values=[...measured.objects.values()],n=uiImpactSum(values.map(v=>v.numerator)),d=uiImpactSum(values.map(v=>v.denominator)),summary=uiContext.summaries[side],label=side==='baseline'?'基线':'当前';
      sets[side]=measured.objects;issues.push(...measured.issues.map(issue=>label+issue));
      const exact=Number.isFinite(n)&&d>0?n/d*scale:null;
      sides[side]={numerator:scope?n:summary[numerator],denominator:scope?d:summary[denominator],value:exact,reportedValue:scope?null:summary[state.metric]};
      if(!Number.isFinite(n)||!Number.isFinite(d)||!Number.isFinite(sides[side].numerator)||!Number.isFinite(sides[side].denominator))issues.push(label+'数据未知');
      else if(d===0||sides[side].denominator===0)issues.push(label+'分母为零，不适用');
      else if(!scope&&(summary[numerator]!==n||summary[denominator]!==d||!uiImpactSummaryMatches(summary[state.metric],exact)))issues.push(label+'汇总与明细不一致');
    }
    const b=sides.baseline,c=sides.current,observedIssues=issues.filter(issue=>issue!=='超限阈值变化，净影响分解暂不可用');
    const effects=issues.length?null:{numerator:(c.numerator-b.numerator)/b.denominator*scale,denominator:c.numerator*(b.denominator-c.denominator)/(b.denominator*c.denominator)*scale,delta:c.value-b.value};
    const contributions=[];
    if(effects)for(const path of new Set([...sets.baseline.keys(),...sets.current.keys()])){
      const before=sets.baseline.get(path)||{numerator:0,denominator:0},after=sets.current.get(path)||{numerator:0,denominator:0};
      const n=(after.numerator-before.numerator)/b.denominator*scale,d=c.numerator*(before.denominator-after.denominator)/(b.denominator*c.denominator)*scale;
      // 合并到公共分母后再除，避免两项浮点相加把真实并列值排成先后。
      const value=((after.numerator-before.numerator)*c.denominator+c.numerator*(before.denominator-after.denominator))/(b.denominator*c.denominator)*scale;
      if(n!==0||d!==0)contributions.push({path,numerator:n,denominator:d,value,before,after});
    }
    const strength=item=>Math.abs(item.after.numerator-item.before.numerator)*c.denominator+c.numerator*Math.abs(item.before.denominator-item.after.denominator);
    contributions.sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)||strength(b)-strength(a)||(a.path<b.path?-1:a.path>b.path?1:0));
    const members=[{label:'存续文件',count:0,values:[]},{label:'新增文件',count:0,values:[]},{label:'移出文件',count:0,values:[]}],range=scopeRange(scope);
    for(let f=range[0];f<range[1];f++){
      const before=!!S.files.bEx[f],after=!!S.files.cEx[f],item=members[before&&after?0:after?1:2],b=uiFileValue(f,'code','baseline'),c=uiFileValue(f,'code','current');
      item.count++;item.values.push(b==null||c==null?null:c-b);
    }
    const transitions={limited:observedIssues.length>0,entered:0,exited:0};
    if(threshold){const source=uiSource(type);for(let i=0;i<source.count;i++){
      const path=source.path(i);if(scope&&path!==scope&&!path.startsWith(scope+'/')||!source.included(i))continue;
      const row=source.row(i);transitions.limited ||= !row.transitionKnown;transitions.entered+=Number(row.flags.includes('entered'));transitions.exited+=Number(row.flags.includes('exited'));
    }}
    uiImpactCache={key:cacheKey,value:{...sides,scope,numerator,denominator,ratio,threshold,issues:[...new Set(issues)],effects,observedDelta:observedIssues.length?null:c.value-b.value,members:members.map(({values,...item})=>({...item,lines:uiImpactSum(values)})),transitions},contributions,maximum:Math.abs(contributions[0]?.value||0)};
  }
  const cached=uiImpactCache,page=uiPage(cached.contributions,state.contributionPage,5);
  return {...cached.value,contributions:page.rows,ranking:{total:page.total,page:page.page,pages:page.pages,maximum:cached.maximum}};
}
