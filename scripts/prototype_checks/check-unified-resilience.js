/* 真实页面故障与并发检查；通过公开 reader 注入故障，不改变业务输入。 */
(async()=>{
  const checks=[],reader=window.prototypeReader,read=reader.read;
  const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw new Error(name);};
  const state=()=>JSON.parse(document.querySelector('.state-inspector pre').textContent);
  const wait=async(expected='ready')=>{
    const deadline=performance.now()+15000;
    while(document.documentElement.dataset.queryState==='loading'){
      if(performance.now()>deadline)throw new Error('查询超时');
      await new Promise(requestAnimationFrame);
    }
    check('查询状态 '+expected,document.documentElement.dataset.queryState===expected);
    await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  };
  const click=async selector=>{const node=document.querySelector(selector);check('存在 '+selector,!!node);node.click();await wait();};
  const search=value=>{const input=document.querySelector('#query-form [name="query"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
  await wait();
  await click('[data-action="view"][data-value="workspace"]');
  await click('[data-action="status"][data-value="all"]');
  const last=document.querySelector('.data-table').textContent;
  try{
    reader.read=async()=>{throw new Error('<img src=x onerror="window.__injected=1">查询故障');};
    search('failure');await wait('error');
    check('失败保留上次成功结果',document.querySelector('.data-table').textContent===last);
    check('失败错误转义',!document.querySelector('#query-notice img')&&!window.__injected);
    check('失败明确旧结果',document.querySelector('#query-notice').textContent.includes('上次成功结果'));
    reader.read=read;
    await click('[data-action="retry"]');
    check('重试使用最新查询',state().query==='failure'&&state().result===0);

    // 请求已发出后再发下一次；分别让旧成功和旧失败晚到。
    for(const failure of [false,true]){
      let release,started;
      const pending=new Promise(resolve=>{started=resolve;});
      reader.read=async function(s){
        if(s.query==='__old_response__'){
          const payload=await read.call(this,s);started();
          await new Promise(resolve=>{release=resolve;});
          if(failure)throw new Error('旧查询失败');
          return payload;
        }
        return read.call(this,s);
      };
      search('__old_response__');await pending;
      search('parser.c');await wait();
      const before=JSON.stringify(state());release();
      await new Promise(resolve=>setTimeout(resolve,50));
      check((failure?'旧失败':'旧成功')+'不覆盖新状态',JSON.stringify(state())===before&&document.documentElement.dataset.queryState==='ready');
      check('完整名称查询',state().result===1&&document.querySelector('.data-table').textContent.includes('parser.c'));
    }
    reader.read=read;
    search('<svg onload="window.__injected=1">');await wait();
    check('查询注入不执行',!window.__injected&&!document.querySelector('#app svg[onload]'));
    check('查询原值保留',state().query==='<svg onload="window.__injected=1">');
    search('');await wait();
  }finally{reader.read=read;}
  return {result:'passed',checks,offline:!navigator.onLine,userAgent:navigator.userAgent};
})();
