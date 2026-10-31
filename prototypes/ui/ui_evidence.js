/* 一次性关联证据查询：完整集合在 Worker 内过滤，仅返回当前页。 */
function uiEvidencePage(items, query, requested, text) {
  const needle=String(query||'').trim().toLowerCase();
  const filtered=needle?items.filter(item=>text(item).toLowerCase().includes(needle)):items;
  return {...uiPage(filtered,requested,12),scopeTotal:items.length};
}

function uiEvidence(state, selectedRow) {
  if(!selectedRow)return null;
  const row=selectedRow,controls=state.evidenceControls||{},result={objectId:row.id};
  const page=(items,key,text)=>uiEvidencePage(items,controls[key]?.query,controls[key]?.page,text);
  if(row.kind==='folder'){
    const directory=S.dirs[S.dirByPath.get(row.path)];if(!directory)return result;
    const members=[];
    const append=(path,type,before,after)=>members.push({path,name:path.slice(path.lastIndexOf('/')+1),type,before,after,status:!before&&after?'entered':before&&!after?'exited':'same'});
    for(const f of directory.cf)append(S.paths[f],'文件',!!S.files.bEx[f],!!S.files.cEx[f]);
    for(const d of directory.cd){const child=S.dirs[d];append(child.p,'目录',child.bF>0,child.cF>0);}
    members.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    const counts={entered:0,exited:0,same:0};for(const member of members)counts[member.status]++;
    const status=state.memberStatus||'changes',filtered=members.filter(m=>status==='all'||status==='changes'&&m.status!=='same'||m.status===status);
    result.members={...uiEvidencePage(filtered,state.memberQuery,state.memberPage,m=>m.path),counts,totalMembers:members.length};
    result.coverage={};
    for(const [side,key] of [['baseline','kB'],['current','kC']]){
      const recovered=members.filter(m=>m[side==='baseline'?'before':'after']).length;
      const declared=directory[key]==null?null:side==='current'&&uiContext.limitedFolder===S.dirByPath.get(row.path)?directory[key]+3:directory[key];
      result.coverage[side]={declared,recovered,limited:declared==null||declared!==recovered};
    }
    return result;
  }
  if(row.kind!=='file'||!['duplication','sourceDuplication','dupfiles','sourceDupfiles'].includes(state.type))return result;
  const file=S.paths.indexOf(row.path),whole=['dupfiles','sourceDupfiles'].includes(state.type),peers=new Set();
  result.kind=whole?'whole':'fragments';result.sides={};
  for(const side of ['baseline','current']){
    let groups;
    if(whole){
      groups=[];for(let g=0;g<S.dup[side].length;g++)if(S.dup[side][g].m.includes(file))groups.push(g);
    }else groups=[...new Set((S.fragIndex.get(file)||[]).filter(item=>item.side===side).map(item=>item.g))];
    const id=g=>whole?S.dup[side][g].id:S.meta.groups[side][g];
    const indices=g=>whole?S.dup[side][g].m:S.groupFragIdx[side][g];
    const memberFile=i=>whole?i:S.frag[side].f[i];
    for(const g of groups)for(const i of indices(g))if(memberFile(i)!==file)peers.add(memberFile(i));
    const active=groups.find(g=>String(id(g))===String(state.groups?.[side]))??groups[0];
    const groupPage=page(groups,'groups-'+side,g=>String(id(g)));
    const members=active==null?[]:indices(active);
    const memberPage=page(members,'fragments-'+side,i=>whole?S.paths[i]:`${S.paths[memberFile(i)]} ${S.frag[side].s[i]} ${S.frag[side].l[i]}`);
    result.sides[side]={active:active==null?null:id(active),groups:{...groupPage,rows:groupPage.rows.map(g=>({id:id(g),total:indices(g).length}))},members:{...memberPage,rows:memberPage.rows.map(i=>whole?{path:S.paths[i]}:{path:S.paths[memberFile(i)],start_line:S.frag[side].s[i],code_duplication:S.frag[side].l[i]})}};
  }
  const peerPage=page([...peers].sort((a,b)=>a-b),'peers',f=>S.paths[f]);
  result.peers={...peerPage,rows:peerPage.rows.map(f=>{const b=uiFileValue(f,'duplication','baseline'),c=uiFileValue(f,'duplication','current');return {path:S.paths[f],b,c,delta:b==null||c==null?null:c-b};})};
  return result;
}
