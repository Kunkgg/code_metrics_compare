/* 明细查询共用的对象索引与数值语义；完整命中仅缓存 ID。 */
let uiMethods=null,uiPositions=null,uiContext=null;
const uiHeader=path=>/\.(h|hh|hpp|hxx)$/.test(path);
const uiThreshold=type=>({hugeHeader:'huge_headerfile',hugeSource:'huge_non_headerfile',hugeMethod:'huge_method',hugeCC:'huge_cyclomatic_complexity',folders:'huge_folder'}[type]);
const uiMethodTypes=new Set(['methodLines','cc','hugeMethod','hugeCC']);
const uiFileTypes=new Set(['code','duplication','sourceDuplication','dupfiles','sourceDupfiles','hugeHeader','hugeSource']);
const uiException=row=>row.flags.some(flag=>['unknown','ambiguous','incomparable'].includes(flag));

function uiSetContext(scenario){
  if(uiContext?.scenario===scenario)return uiContext;
  const summaries=structuredClone(S.meta.summaries);
  uiContext={scenario,summaries,unknownDupFile:-1,limitedFolder:-1,comparisonIssues:S.meta.integrity?.comparisonIssues||[]};
  if(scenario==='limited'){
    const path=S.meta.storyPaths?.utilsGrow;
    uiContext.unknownDupFile=path?S.paths.indexOf(path.replace(S.meta.root+'/','')):S.paths.findIndex((p,i)=>S.files.cEx[i]&&!uiHeader(p)&&S.files.cD[i]>0);
    uiContext.limitedFolder=S.dirByPath.get('src/bulk')??S.dirs.findIndex(d=>d.kC!=null);
    summaries.current.code_size+=123;
    summaries.current.huge_threshold.huge_cyclomatic_complexity=25;
    let count=0;for(const value of S.mC.views.cc)if(value>25)count++;
    summaries.current.huge_cyclomatic_complexity_total=count;
    summaries.current.huge_cyclomatic_complexity_ratio=count/summaries.current.methods_total*100;
  }
  return uiContext;
}

function uiMethodIndex(){
  if(uiMethods)return uiMethods;
  const columns={file:[],name:[],bStart:[],bCount:[],cStart:[],cCount:[]};
  const records={b:new Uint32Array(S.mB.count),c:new Uint32Array(S.mC.count)},used={b:0,c:0};
  const range=new Uint32Array(S.F+1);
  for(let file=0;file<S.F;file++){
    range[file]=columns.file.length;
    const names=new Map();
    for(const [side,methods,bounds] of [['b',S.mB,S.rangeB],['c',S.mC,S.rangeC]]){
      for(let index=bounds[file];index<bounds[file+1];index++){
        const name=methods.views.na[index];
        if(!names.has(name))names.set(name,{b:[],c:[]});
        names.get(name)[side].push(index);
      }
    }
    for(const [name,items] of names){
      columns.file.push(file);columns.name.push(name);
      for(const side of ['b','c']){
        columns[side+'Start'].push(used[side]);columns[side+'Count'].push(items[side].length);
        records[side].set(items[side],used[side]);used[side]+=items[side].length;
      }
    }
  }
  range[S.F]=columns.file.length;
  uiMethods={...Object.fromEntries(Object.entries(columns).map(([key,values])=>[key,Uint32Array.from(values)])),records,range,count:columns.file.length};
  return uiMethods;
}

function uiPositionIndex(){
  if(uiPositions)return uiPositions;
  uiPositions={};
  for(const type of ['unsafe','redundant']){
    const keys=new Map(),rows=[];
    for(const [side,label] of [['b','baseline'],['c','current']]){
      const data=(type==='unsafe'?S.unsafe:S.redundant)[label],occurrences=new Map();
      for(let i=0;i<data.f.length;i++){
        const base=type==='unsafe'?`${data.f[i]}:${data.na[i]}:${data.ln[i]}`:`${data.f[i]}:${data.ln[i]}`;
        const occurrence=occurrences.get(base)||0;occurrences.set(base,occurrence+1);
        const key=type==='unsafe'?base:base+':'+occurrence;
        if(!keys.has(key)){keys.set(key,rows.length);rows.push({file:data.f[i],name:type==='unsafe'?data.na[i]:null,line:data.ln[i],occurrence,b:0,c:0});}
        rows[keys.get(key)][side]=1;
      }
    }
    uiPositions[type]=rows;
  }
  return uiPositions;
}

function uiFileValue(file,type,side){
  const tag=side==='baseline'?'b':'c',v=S.files;
  if(!v[tag+'Ex'][file])return 0;
  if(type==='dupfiles'||type==='sourceDupfiles')return S.dupMember[side][file];
  const duplication=type==='duplication'||type==='sourceDuplication',column=duplication?'D':'N',bit=duplication?4:1;
  if(v[tag+'Valid']&&!(v[tag+'Valid'][file]&bit))return null;
  if(duplication&&side==='current'&&uiContext.unknownDupFile===file)return null;
  return v[tag+column][file];
}

function uiMethodValue(index,type,side){
  const m=uiMethodIndex(),tag=side==='baseline'?'b':'c';
  const data=(tag==='b'?S.mB:S.mC).views,cc=type==='cc'||type==='hugeCC';
  let total=0;
  for(let at=m[tag+'Start'][index];at<m[tag+'Start'][index]+m[tag+'Count'][index];at++){
    const record=m.records[tag][at];
    if(data.valid&&!(data.valid[record]&(cc?2:1)))return null;
    total+=data[cc?'cc':'ln'][record];
  }
  return total;
}

function uiMembers(directory){
  let b=0,c=0,entered=0,exited=0;
  for(const f of directory.cf){const before=!!S.files.bEx[f],after=!!S.files.cEx[f];b+=before;c+=after;entered+=!before&&after;exited+=before&&!after;}
  for(const index of directory.cd){const before=S.dirs[index].bF>0,after=S.dirs[index].cF>0;b+=before;c+=after;entered+=!before&&after;exited+=before&&!after;}
  return {b,c,entered,exited};
}

function uiSource(type){
  const method=uiMethodTypes.has(type),file=uiFileTypes.has(type),position=type==='unsafe'||type==='redundant';
  if(!method&&!file&&!position&&type!=='folders')throw new Error('未知明细类型：'+type);
  const m=method?uiMethodIndex():null,p=position?uiPositionIndex()[type]:null,threshold=uiThreshold(type);
  const limits=threshold?{b:uiContext.summaries.baseline.huge_threshold[threshold],c:uiContext.summaries.current.huge_threshold[threshold]}:null;
  const fileId=i=>file?i:method?m.file[i]:position?p[i].file:null;
  const nameId=i=>method?m.name[i]:position&&type==='unsafe'?p[i].name:0;
  const value=(i,side)=>{
    if(file)return uiFileValue(i,type,side);
    if(method)return uiMethodValue(i,type,side);
    if(position)return p[i][side==='baseline'?'b':'c'];
    const key=side==='baseline'?'kB':'kC',declared=S.dirs[i][key];
    return declared!=null?side==='current'&&uiContext.limitedFolder===i?declared+3:declared:uiMembers(S.dirs[i])[side==='baseline'?'b':'c'];
  };
  const path=i=>type==='folders'?S.dirs[i].p:S.paths[fileId(i)];
  const name=i=>method||type==='unsafe'?S.names[nameId(i)]:type==='redundant'?'冗余代码':path(i).slice(path(i).lastIndexOf('/')+1);
  const included=i=>{
    if(type==='sourceDuplication'||type==='sourceDupfiles'||type==='hugeSource'){if(uiHeader(path(i)))return false;}
    if(type==='hugeHeader'&&!uiHeader(path(i)))return false;
    if(type==='dupfiles'||type==='sourceDupfiles')return !!(value(i,'baseline')||value(i,'current'));
    if(type==='folders')return S.dirs[i].kB!=null||S.dirs[i].kC!=null;
    if(!threshold)return true;
    if(method){
      for(const [side,data] of [['b',S.mB.views],['c',S.mC.views]]){
        const cc=type==='hugeCC',field=cc?'cc':'ln';
        for(let at=m[side+'Start'][i];at<m[side+'Start'][i]+m[side+'Count'][i];at++){
          const record=m.records[side][at];
          if(data.valid&&!(data.valid[record]&(cc?2:1))||data[field][record]>limits[side])return true;
        }
      }
      return false;
    }
    const b=value(i,'baseline'),c=value(i,'current');return b==null||c==null||b>limits.b||c>limits.c;
  };
  const row=i=>{
    const b=value(i,'baseline'),c=value(i,'current'),ambiguous=method&&(m.bCount[i]>1||m.cCount[i]>1),flags=[];
    const before=method?m.bCount[i]>0:file?!!S.files.bEx[i]:position?!!p[i].b:S.dirs[i].kB!=null;
    const after=method?m.cCount[i]>0:file?!!S.files.cEx[i]:position?!!p[i].c:S.dirs[i].kC!=null;
    let entered=!before&&after,exited=before&&!after,transitionKnown=true;
    if(type==='dupfiles'||type==='sourceDupfiles'){entered=!b&&!!c;exited=!!b&&!c;}
    if(threshold&&type!=='folders'){
      transitionKnown=!ambiguous&&b!=null&&c!=null;
      entered=transitionKnown&&!(b>limits.b)&&c>limits.c;exited=transitionKnown&&b>limits.b&&!(c>limits.c);
    }
    const mismatch=type==='folders'&&(uiContext.limitedFolder===i||S.dirs[i].kB!=null&&S.dirs[i].kB!==uiMembers(S.dirs[i]).b||S.dirs[i].kC!=null&&S.dirs[i].kC!==uiMembers(S.dirs[i]).c);
    const incomparable=uiContext.comparisonIssues.length>0||!!limits&&(!Number.isFinite(limits.b)||!Number.isFinite(limits.c)||mismatch);
    if(type==='folders'&&!incomparable){const members=uiMembers(S.dirs[i]);entered=!(members.b>limits.b)&&members.c>limits.c;exited=members.b>limits.b&&!(members.c>limits.c);}
    if(incomparable)transitionKnown=false;
    if(ambiguous)flags.push('ambiguous');
    if(b==null||c==null)flags.push('unknown');
    if(incomparable)flags.push('incomparable');
    const delta=b==null||c==null?null:c-b;
    if(!incomparable&&delta>0)flags.push('growth');if(!incomparable&&delta<0)flags.push('decrease');
    if(entered&&transitionKnown)flags.push('entered');if(exited&&transitionKnown)flags.push('exited');
    const objectPath=path(i),objectName=name(i),kind=file?'file':method?'method':position?type:'folder';
    const thresholdChanged=!!limits&&Number.isFinite(limits.b)&&Number.isFinite(limits.c)&&limits.b!==limits.c;
    const result={thresholdChanged,warning:thresholdChanged?'阈值变化；两侧分别按各自阈值严格大于判定，清单进出不证明代码恶化或改善。':null,kind,path:objectPath,name:objectName,b,c,delta,flags,changed:ambiguous||delta!==0||thresholdChanged&&transitionKnown&&(entered||exited)||incomparable,ambiguous,transitionKnown};
    if(uiContext.comparisonIssues.length)result.warning=[result.warning,...uiContext.comparisonIssues].filter(Boolean).join('；');
    if(method){
      result.beforeCount=m.bCount[i];result.afterCount=m.cCount[i];
      if(ambiguous){result.comparisonBasis='same-name-total';result.warning=[result.warning,'同名函数可能混淆；此处比较同文件同名函数集合的总量。'].filter(Boolean).join('；');}
    }
    if(position)result.line=p[i].line;
    return result;
  };
  const detail=(i,state)=>{
    const result=row(i);
    const identity=method?JSON.stringify([result.path,result.name]):position?JSON.stringify(type==='unsafe'?[result.path,result.name,p[i].line]:[result.path,p[i].line,p[i].occurrence]):result.path;
    result.id=`${result.kind}:${identity}`;
    if(file){
      const v=S.files;
      result.before=v.bEx[i]?[uiFileValue(i,'code','baseline'),v.bValid&&!(v.bValid[i]&2)?null:v.bR[i],uiFileValue(i,'duplication','baseline')]:undefined;
      result.after=v.cEx[i]?[uiFileValue(i,'code','current'),v.cValid&&!(v.cValid[i]&2)?null:v.cR[i],uiFileValue(i,'duplication','current')]:undefined;
    }
    if(method){
      result.recordPages={};
      for(const [side,tag,data,target] of [['baseline','b',S.mB.views,'before'],['current','c',S.mC.views,'after']]){
        const count=m[tag+'Count'][i],pages=Math.ceil(count/20),page=pages?Math.max(1,Math.min(state.methodPages?.[side]||1,pages)):0;
        const start=m[tag+'Start'][i],items=[];
        for(let at=start+Math.max(0,page-1)*20;at<Math.min(start+page*20,start+count);at++){
          const raw=m.records[tag][at];
          items.push({path:result.path,file_name:S.meta.root+'/'+result.path,method_name:result.name,start_line:data.st[raw],end_line:data.en[raw],nbnc_loc:data.valid&&!(data.valid[raw]&1)?null:data.ln[raw],cyclomatic_complexity:data.valid&&!(data.valid[raw]&2)?null:data.cc[raw]});
        }
        result[target]=items;result.recordPages[side]={total:count,page,pages};
      }
    }
    if(position){result.before=p[i].b?{line:p[i].line}:undefined;result.after=p[i].c?{line:p[i].line}:undefined;}
    if(type==='folders'){
      const members=uiMembers(S.dirs[i]);
      Object.assign(result,{declaredBefore:S.dirs[i].kB,declaredAfter:S.dirs[i].kC,recoveredBefore:members.b,recoveredAfter:members.c,addedMembers:members.entered,removedMembers:members.exited});
    }
    return result;
  };
  const tie=(a,b)=>{
    if(type==='folders')return a-b;
    return fileId(a)-fileId(b)||nameId(a)-nameId(b)||(position?p[a].line-p[b].line:0)||a-b;
  };
  return {type,count:file?S.F:method?m.count:position?p.length:S.dirs.length,fileId,path,name,value,included,row,detail,tie,
    range:(lo,hi)=>file?[lo,hi]:method?[m.range[lo],m.range[hi]]:[0,position?p.length:S.dirs.length],
    identitySort:tie};
}

function uiMatchesStatus(row,status){
  if(status==='all')return true;
  if(status==='changes')return row.changed;
  if(status==='exceptions')return uiException(row);
  if(status==='unchanged')return row.delta===0&&!(row.thresholdChanged&&(row.flags.includes('entered')||row.flags.includes('exited')))&&!uiException(row);
  return row.flags.includes(status)&&(!['entered','exited'].includes(status)||row.transitionKnown);
}

function uiScopeAggregate(type,lo,hi){
  if(!['code','duplication','sourceDuplication','methodLines','cc'].includes(type))return null;
  const result={};
  for(const [side,methods,range] of [['baseline',S.mB,S.rangeB],['current',S.mC,S.rangeC]]){
    let known=0,valid=0,count=0;
    if(uiMethodTypes.has(type)){
      const field=type==='cc'?'cc':'ln',bit=type==='cc'?2:1;
      for(let i=range[lo];i<range[hi];i++){count++;if(methods.views.valid&&!(methods.views.valid[i]&bit))continue;valid++;known+=methods.views[field][i];}
    }else for(let f=lo;f<hi;f++){
      if(type==='sourceDuplication'&&uiHeader(S.paths[f])||!S.files[(side==='baseline'?'b':'c')+'Ex'][f])continue;
      count++;const value=uiFileValue(f,type,side);if(value==null)continue;valid++;known+=value;
    }
    result[side]={value:count===valid?known:null,knownValue:known,count,valid};
  }
  result.delta=result.baseline.value==null||result.current.value==null?null:result.current.value-result.baseline.value;
  return result;
}
