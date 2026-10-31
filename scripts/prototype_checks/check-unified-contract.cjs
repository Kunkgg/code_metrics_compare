/* 小夹具的独立输入预期：全范围排序、跨页、数值条件、精确文件和目录统计。 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {loadWorker}=require('./worker-harness.cjs');
(async()=>{
  const [inputDir,reportPath]=process.argv.slice(2);
  if(!inputDir||!reportPath)throw new Error('用法：node check-unified-contract.cjs 输入目录 HTML');
  const reports=Object.fromEntries(['baseline','current'].map(side=>[side,JSON.parse(fs.readFileSync(path.join(inputDir,side+'.json'),'utf8'))]));
  // 必填扫描明细不能以空集合兜底，否则字段改名或缺失会被静默漏检。
  for (const [side, report] of Object.entries(reports)) {
    const groups = report.detail_metrics.file_duplication;
    if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
      throw new Error(`${side}.detail_metrics.file_duplication 必须是重复文件组对象`);
    }
    for (const [id, members] of Object.entries(groups)) {
      if (!Array.isArray(members) || members.some(member => typeof member !== 'string' || !Object.hasOwn(report.detail_metrics.file_sizes, member))) {
        throw new Error(`${side}.detail_metrics.file_duplication.${id} 必须是扫描内文件路径数组`);
      }
    }
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(inputDir,'manifest.json'),'utf8')),prefix=manifest.root+'/';
  const relative=value=>{if(!value.startsWith(prefix))throw new Error('夹具根不符');return value.slice(prefix.length);};
  const files=[...new Set(Object.values(reports).flatMap(report=>Object.keys(report.detail_metrics.file_sizes)))].sort().map(full=>{
    const before=reports.baseline.detail_metrics.file_sizes[full],after=reports.current.detail_metrics.file_sizes[full];
    return {path:relative(full),b:before?.[0]??0,c:after?.[0]??0,delta:(after?.[0]??0)-(before?.[0]??0),before:before??null,after:after??null};
  });
  const {send,source}=await loadWorker(fs.readFileSync(reportPath,'utf8'),'report-worker');
  const state={view:'workspace',scenario:'normal',type:'code',metric:'code_size',directory:'',query:'',exactFile:null,searchScope:'directory',status:'all',sort:'path:asc',numberFilter:null,page:1,pageSize:17,selected:null,directoryPage:1,chartPage:1,overviewChanges:['growth','decrease']};
  const read=patch=>send({op:'snapshot',state:{...state,...patch}});
  const checks=[];
  const check=(name,expected,actual)=>checks.push({name,pass:JSON.stringify(expected)===JSON.stringify(actual),expected,actual});
  const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const text=(a,b)=>a<b?-1:a>b?1:0;
  for(const sort of ['path:asc','path:desc','delta:desc','b:asc','c:desc']){
    const [field,direction]=sort.split(':'),sign=direction==='asc'?1:-1;
    const expected=[...files].sort((a,b)=>field==='path'?sign*text(a.path,b.path):sign*(a[field]-b[field])||text(a.path,b.path));
    const actual=[];
    for(let page=1;page<=Math.ceil(files.length/state.pageSize);page++){
      const snapshot=await read({sort,page});
      actual.push(...snapshot.query.rows.map(({path,b,c,delta,before,after})=>({path,b,c,delta,before:before??null,after:after??null})));
      if(snapshot.query.rows.length>state.pageSize)throw new Error('响应超出当前页');
    }
    check('all-pages.'+sort,{total:expected.length,sha256:hash(expected)},{total:actual.length,sha256:hash(actual)});
  }
  for(const page of [1,51,files.length]){
    const {query}=await read({page,pageSize:1});
    check('page.'+page,{page,paths:[files[page-1].path]},{page:query.page,paths:query.rows.map(r=>r.path)});
  }
  const fullSum=side=>Object.values(reports[side].detail_metrics.file_sizes).reduce((sum,v)=>sum+v[0],0);
  const filtered=await read({query:'.c',numberFilter:{field:'increase',operator:'gte',value:20},status:'growth',pageSize:200});
  const expected=files.filter(r=>r.path.includes('.c')&&r.delta>=20);
  check('combined-filter',{total:expected.length,paths:expected.slice(0,200).map(r=>r.path)},{total:filtered.query.total,paths:filtered.query.rows.map(r=>r.path)});
  check('complete-scope-unchanged',{baseline:fullSum('baseline'),current:fullSum('current'),count:files.length},{baseline:filtered.query.aggregate.baseline.value,current:filtered.query.aggregate.current.value,count:filtered.query.scopeCount});
  const exact=files.find(r=>files.some(other=>other.path!==r.path&&other.path.includes(r.path)))||files[0];
  const selected=await read({exactFile:exact.path,query:exact.path,page:1});
  check('exact-file',[exact.path],selected.query.rows.map(r=>r.path));
  check('exact-file-aggregate',[exact.b,exact.c],[selected.query.aggregate.baseline.value,selected.query.aggregate.current.value]);
  const cleared=await read({page:1});
  check('clear-exact-file',files.length,cleared.query.total);
  const empty=await read({query:'__absent_cmetrics_789__',page:51});
  check('empty',{page:0,pages:0,total:0,rows:[]},{page:empty.query.page,pages:empty.query.pages,total:empty.query.total,rows:empty.query.rows});
  const dirs=new Set(['']);
  for(const file of files){const parts=file.path.split('/');for(let i=1;i<parts.length;i++)dirs.add(parts.slice(0,i).join('/'));}
  for(const directory of dirs){
    const children=[...dirs].filter(p=>p&&p.slice(0,Math.max(0,p.lastIndexOf('/')))===directory).sort();
    const actual=[];
    for(let page=1;page<=Math.max(1,Math.ceil(children.length/50));page++){
      const result=await read({directory,directoryPage:page});
      actual.push(...result.directories.rows);
      const expectedCount=files.filter(r=>!directory||r.path.startsWith(directory+'/')).length;
      check('scope-count.'+directory+'.'+page,expectedCount,result.query.scopeCount);
    }
    const expected=children.map(p=>({path:p,count:Object.keys(reports.current.detail_metrics.file_sizes).map(relative).filter(f=>f.startsWith(p+'/')).length}));
    check('directories.'+directory,expected,actual);
  }
  const overview=cleared.overview;
  for(const direction of ['growth','decrease','unchanged']){
    const expected=files.filter(r=>(r.delta>0?'growth':r.delta<0?'decrease':'unchanged')===direction).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)||text(a.path,b.path));
    check('overview.'+direction,{total:expected.length,paths:expected.slice(0,8).map(r=>r.path)},{total:overview.files[direction].total,paths:overview.files[direction].rows.map(r=>r.path)});
  }
  const unsupported=await read({type:'cc',metric:'cyclomatic_complexity_per_method'});
  check('unsupported-is-explicit',true,!!unsupported.unavailable&&unsupported.query.total===null&&unsupported.query.rows.length===0);
  const failed=checks.filter(c=>!c.pass).length;
  console.log(JSON.stringify({protocol:'unified-files-1',workerSha256:crypto.createHash('sha256').update(source).digest('hex'),checks:checks.length,failed,results:checks},null,2));
  process.exitCode=failed?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
