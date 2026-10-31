/* 在 Node VM 中执行产物内的真实 Worker；只提供消息传输与浏览器解压原语。 */
'use strict';
const vm = require('node:vm');

async function loadWorker(html, elementId) {
  const source = html.match(new RegExp(`<script type="text/plain" id="${elementId}">([\\s\\S]*?)<\\/script>`))?.[1];
  if(!source)throw new Error(`缺少内嵌 Worker：${elementId}`);
  let response,id=0;
  const context=vm.createContext({self:{postMessage:message=>{response=message;}},performance,structuredClone,atob,Blob,DecompressionStream,Response,TextDecoder,Uint8Array,Uint32Array,Int32Array,DataView,console});
  vm.runInContext(source,context,{filename:elementId+'.js'});
  const send=async message=>{
    response=null;
    await context.self.onmessage({data:{...message,id:++id}});
    if(!response||response.id!==id)throw new Error('Worker未返回匹配响应');
    if(response.type==='error')throw new Error(response.message);
    return response.payload??response;
  };
  for(const match of html.matchAll(/<script type="application\/octet-stream" data-block-kind="([^"]+)">([\s\S]*?)<\/script>/g))await send({op:'load',kind:match[1],b64:match[2]});
  await send({op:'finish'});
  return {send,source};
}
module.exports={loadWorker};
