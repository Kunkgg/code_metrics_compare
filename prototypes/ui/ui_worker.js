/* 复用容量 Worker 的紧凑列和索引，为现有 UI 返回有界快照。
 * 完整范围、过滤结果与当前页分别计数。 */
const UI = {query: null, overview: null};

function uiPage(items, requested, size) {
  const pages = Math.ceil(items.length / size);
  const page = pages ? Math.max(1, Math.min(Math.trunc(requested || 1), pages)) : 0;
  return {rows: items.slice(Math.max(0, page-1)*size, page*size), total: items.length, page, pages};
}

function uiFile(f) {
  const v=S.files,path=S.paths[f],before=v.bEx[f]?[v.bN[f],v.bR[f],v.bD[f]]:undefined,after=v.cEx[f]?[v.cN[f],v.cR[f],v.cD[f]]:undefined;
  const b=before?.[0]??0,c=after?.[0]??0,delta=c-b,flags=[];
  if(delta>0)flags.push('growth');
  if(delta<0)flags.push('decrease');
  if(!before&&after)flags.push('entered');
  if(before&&!after)flags.push('exited');
  return {id:`file:${path}`,kind:'file',path,name:path.slice(path.lastIndexOf('/')+1),before,after,b,c,delta,flags,changed:delta!==0};
}

function uiAggregate(directory) {
  if(!directory)return {baseline:{value:0,valid:0,count:0},current:{value:0,valid:0,count:0},delta:0};
  const baseline={value:directory.bC,valid:directory.bF,count:directory.bF};
  const current={value:directory.cC,valid:directory.cF,count:directory.cF};
  return {baseline,current,delta:current.value-baseline.value};
}

function uiMatchesNumber(row, condition) {
  if(!condition)return true;
  let value=row[condition.field];
  if(condition.field==='increase'||condition.field==='decrease'){
    if(row.delta==null||row.flags.includes('incomparable'))return false;
    if(condition.field==='increase'?row.delta<=0:row.delta>=0)return false;
    value=condition.field==='increase'?row.delta:-row.delta;
  }
  if(value==null)return false;
  return condition.operator==='gte'?value>=condition.value:condition.operator==='lte'?value<=condition.value:value>=condition.value&&value<=condition.upper;
}

function uiQuery(state) {
  const scope=state.exactFile||(state.searchScope==='all'?'':state.directory),source=uiSource(state.type);
  const key=JSON.stringify([state.scenario,state.type,scope,!!state.exactFile,state.query,state.numberFilter,state.status,state.sort]);
  if(UI.query?.key!==key){
    let [lo,hi]=scopeRange(scope);
    if(state.exactFile){const index=S.paths.indexOf(scope);[lo,hi]=index<0?[0,0]:[index,index+1];}
    const [start,end]=source.range(lo,hi),[field,direction]=state.sort.split(':'),sign=direction==='asc'?1:-1;
    const keys=field==='path'?null:new Float64Array(end-start),query=state.query.trim().toLowerCase(),ids=[];
    const counts={all:0,changes:0,growth:0,decrease:0,unchanged:0,entered:0,exited:0,exceptions:0};
    let scopeCount=0,exceptionsCount=0,resultExceptionsCount=0;
    for(let index=start;index<end;index++){
      if(state.type==='folders'){
        const path=source.path(index);if(scope&&path!==scope&&!path.startsWith(scope+'/'))continue;
      }else if(source.fileId(index)<lo||source.fileId(index)>=hi)continue;
      if(!source.included(index))continue;
      scopeCount++;
      const row=source.row(index),exception=uiException(row);
      if(exception)exceptionsCount++;
      if(query&&!`${row.path} ${row.name}`.toLowerCase().includes(query)||!uiMatchesNumber(row,state.numberFilter))continue;
      counts.all++;if(row.changed)counts.changes++;if(exception)counts.exceptions++;
      if(uiMatchesStatus(row,'unchanged'))counts.unchanged++;
      for(const flag of row.flags)if(Object.hasOwn(counts,flag))counts[flag]++;
      if(!uiMatchesStatus(row,state.status))continue;
      ids.push(index);if(exception)resultExceptionsCount++;
      if(keys)keys[index-start]=row[field]==null||field==='delta'&&row.flags.includes('incomparable')?NaN:row[field];
    }
    ids.sort(field==='path'?(a,b)=>source.identitySort(a,b)*sign:(a,b)=>{
      const av=keys[a-start],bv=keys[b-start],au=Number.isNaN(av),bu=Number.isNaN(bv);
      if(au||bu)return au&&bu?source.tie(a,b):au?1:-1;
      return (av-bv)*sign||source.tie(a,b);
    });
    UI.query={key,ids,counts,aggregate:uiScopeAggregate(state.type,lo,hi),scopeCount,scope,exceptionsCount,resultExceptionsCount};
  }
  const cached=UI.query,page=uiPage(cached.ids,state.page,Math.max(1,Math.min(state.pageSize||10,200)));
  return {...page,rows:page.rows.map(index=>source.detail(index,state)),counts:cached.counts,aggregate:cached.aggregate,scope:cached.scope,scopeCount:cached.scopeCount,exceptionsCount:cached.exceptionsCount,resultExceptionsCount:cached.resultExceptionsCount};
}

function uiOverview(state) {
  if(!UI.overview){
    const files={growth:{rows:[],total:0},decrease:{rows:[],total:0},unchanged:{rows:[],total:0}};
    // 概览只保留每种方向前8个对象，不复制完整查询行。
    for(let f=0;f<S.F;f++){
      const row=uiFile(f),direction=row.delta>0?'growth':row.delta<0?'decrease':'unchanged',group=files[direction];
      group.total++;
      group.rows.push({...row,fileId:f});
      group.rows.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||a.fileId-b.fileId);
      if(group.rows.length>8)group.rows.pop();
    }
    const directories=S.dirs.filter(d=>d.p==='include'||/^src\/[^/]+$/.test(d.p));
    const chart=directories.map(d=>({path:d.p,file:false,...uiAggregate(d)}));
    const covered=new Uint8Array(S.F);
    for(const directory of directories){const [lo,hi]=scopeRange(directory.p);covered.fill(1,lo,hi);}
    for(let f=0;f<S.F;f++)if(!covered[f]){
      const row=uiFile(f);
      chart.push({path:row.path,file:true,baseline:{value:row.b,count:row.before?1:0,valid:row.before?1:0},current:{value:row.c,count:row.after?1:0,valid:row.after?1:0},delta:row.delta});
    }
    chart.sort((a,b)=>b.delta-a.delta||(a.path<b.path?-1:a.path>b.path?1:0));
    let maximum=1;for(const row of chart)maximum=Math.max(maximum,Math.abs(row.delta));
    UI.overview={files,chart,maximum};
  }
  const shown=UI.overview.chart.filter(row=>state.overviewChanges.includes(row.delta>0?'growth':row.delta<0?'decrease':'unchanged'));
  return {files:UI.overview.files,chart:{...uiPage(shown,state.chartPage,20),maximum:UI.overview.maximum}};
}

function uiTransitions() {
  const transitions={...S.meta.thresholdTransitions};
  if(uiContext.scenario==='limited'){
    const source=uiSource('hugeCC');let entered=0,exited=0,limited=false;
    for(let i=0;i<source.count;i++)if(source.included(i)){
      const row=source.row(i);limited ||= !row.transitionKnown;
      entered+=Number(row.flags.includes('entered'));exited+=Number(row.flags.includes('exited'));
    }
    transitions.hugeCC={entered,exited,limited,thresholdChanged:true};
    transitions.folders={...transitions.folders,limited:true};
  }
  return transitions;
}

function uiSnapshot(state) {
  if(!S.ready)throw new Error('报告数据尚未就绪');
  const context=uiSetContext(state.scenario);
  const query=uiQuery(state);
  const overview=uiOverview(state);
  const directory=S.dirs[S.dirByPath.get(state.directory)];
  const directoryPage=uiPage(directory?.cd||[],state.directoryPage,50);
  const directories={...directoryPage,path:state.directory,rows:directoryPage.rows.map(index=>({path:S.dirs[index].p,count:S.dirs[index].cF}))};
  const sides={};
  for(const side of ['baseline','current']){
    const summary=context.summaries[side];
    sides[side]={summary,report:{summary_metrics:summary,detail_metrics:{method_metrics:[S.meta.maxima[side]]}},files:{},methods:[],groups:[],dupfiles:[],folders:{},positions:[]};
  }
  const evidence=typeof uiEvidence==='function'?uiEvidence(state,query.rows.find(row=>row.id===(state.selected??query.rows[0]?.id))??query.rows[0]):null;
  return {
    impact:uiImpact(state),
    evidence,
    model:{sides,fileRows:query.rows,methodRows:[],folderRows:[],dirs:[],limited:state.scenario==='limited'},
    transitions:uiTransitions(),
    ambiguityCount:S.meta.ambiguousMethodCount,
    overview,directories,query,
    selected:query.rows.find(row=>row.id===state.selected)?.id??query.rows[0]?.id??null,
    unavailable:null,
    evidencePending:!evidence,
  };
}

const capacityMessageHandler=self.onmessage;
self.onmessage=async event=>{
  const message=event.data;
  if(message.op!=='snapshot')return capacityMessageHandler(event);
  const started=performance.now();
  try{
    const payload=uiSnapshot(message.state);
    payload.elapsedWorkerMs=performance.now()-started;
    self.postMessage({type:'result',op:message.op,id:message.id,payload});
  }catch(error){self.postMessage({type:'error',id:message.id,message:error.message});}
};
