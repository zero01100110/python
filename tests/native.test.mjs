import test from 'node:test';
import assert from 'node:assert/strict';
import {JupyterKernel} from '../src/jupyter-kernel.js';
import {newFile} from '../src/core.js';
const url=process.env.PYFORGE_JUPYTER_URL;
test('real Jupyter Server REST/WebSocket kernel integration',{skip:!url,timeout:120000},async t=>{
 const events=[];const kernel=new JupyterKernel({url,token:process.env.PYFORGE_JUPYTER_TOKEN||''},'integration-test',e=>events.push(e),()=>{},()=>Promise.resolve('42'));
 try{
  const code='from helper import value\nfrom pathlib import Path\nanswer = value + 2\nprint(answer)\nPath("generated.txt").write_text(str(answer))';const files=[newFile('main.py',code),newFile('helper.py','value = 40')];
  const result=await kernel.run({code,filename:'main.py',files,argv:[],trace:true},60000);
  assert.equal(result.success,true,result.error);assert.ok(events.some(e=>e.kind==='stdout'&&e.text.includes('42')));assert.equal(result.files.find(f=>f.path==='generated.txt')?.content,'42');assert.ok(result.variables.some(v=>v.name==='answer'&&v.value==='42'));assert.ok(result.trace?.rows.length>0);
  await t.test('native notebook state, complete_request and input_request',async()=>{
   let current=result.files;let r=await kernel.run({code:'x = 8',filename:'nb.ipynb',mode:'notebook',files:current,argv:[]},30000);assert.equal(r.success,true,r.error);current=r.files;
   r=await kernel.run({code:'print(x + 1)\ninput_value = input("Number: ")\nprint(input_value)',filename:'nb.ipynb',mode:'notebook',files:current,argv:[]},30000);assert.equal(r.success,true,r.error);assert.ok(events.some(e=>e.kind==='stdout'&&e.text.includes('42')));
   const completion=await kernel.complete('import math\nmath.sq',2,7);assert.ok(completion.some(c=>c.label.includes('sqrt')));
  });
 }finally{await kernel.reset();}
});
