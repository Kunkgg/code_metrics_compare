/* 离线 Blob Worker 读取入口。只有当前页快照进入主线程。 */
(() => {
  let worker=null,ready=null,nextId=0;
  const pending=new Map();
  function rejectPending(error){for(const request of pending.values())request.reject(error);pending.clear();}
  function send(op,body={}){
    return new Promise((resolve,reject)=>{
      const id=++nextId;
      pending.set(id,{resolve,reject});
      try{worker.postMessage({id,op,...body});}catch(error){pending.delete(id);reject(error);}
    });
  }
  async function boot(){
    const source=document.querySelector('#report-worker').textContent;
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    try{
      worker=new Worker(url);
      worker.onmessage=({data})=>{
        const request=pending.get(data.id);
        if(!request)return;
        pending.delete(data.id);
        data.type==='error'?request.reject(new Error(data.message)):request.resolve(data.payload??data);
      };
      worker.onerror=event=>{
        rejectPending(new Error(event.message||'Worker运行失败'));
        worker?.terminate();worker=null;ready=null;
      };
      for(const block of document.querySelectorAll('[data-block-kind]'))await send('load',{kind:block.dataset.blockKind,b64:block.textContent});
      return await send('finish');
    }catch(error){worker?.terminate();worker=null;rejectPending(error);throw error;}
    finally{URL.revokeObjectURL(url);}
  }
  window.prototypeReader={
    get ready(){
      if(!ready)ready=boot().catch(error=>{ready=null;throw error;});
      return ready;
    },
    async read(state){await this.ready;return send('snapshot',{state});},
  };
  window.addEventListener('pagehide',()=>{worker?.terminate();worker=null;ready=null;rejectPending(new Error('报告已关闭'));});
})();
