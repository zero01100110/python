import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
const runtime=process.env.PYFORGE_RUNTIME_DIR;
test('actual worker limits output and can terminate an infinite Python loop',{skip:!runtime,timeout:30000},async()=>{
 const worker=new Worker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{runtime:path.resolve(runtime)+'/',source:new URL('../src/kernel.worker.js',import.meta.url).href}});
 const events=[];let serial=0;const request=(action,args)=>new Promise((resolve,reject)=>{const id=++serial;const handler=data=>{if(data.type==='event')events.push(data.event);if(data.type==='response'&&data.id===id){worker.off('message',handler);data.error?reject(new Error(data.error)):resolve(data.result);}};worker.on('message',handler);worker.postMessage({id,action,args});});
 try{
  await request('init',{indexURL:'unused'});events.length=0;
  const r=await request('run',{code:'for i in range(90000):\n    print("abcde")',filename:'main.py',files:[],autoPip:false});assert.equal(r.success,true,r.error);
  const chars=events.filter(e=>['stdout','stderr','system'].includes(e.kind)).reduce((n,e)=>n+e.text.length,0);assert.ok(chars<=250000);assert.ok(events.length<1000);
  let completed=false;request('run',{code:'while True:\n    pass',filename:'main.py',files:[],autoPip:false}).then(()=>completed=true);
  await wait(150);const start=performance.now();await worker.terminate();assert.ok(performance.now()-start<5000);assert.equal(completed,false);
 }finally{await worker.terminate();}
});
