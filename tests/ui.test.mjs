// DOM/IndexedDB integration. This is not browser rendering or visual QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Worker as NodeWorker} from 'node:worker_threads';
import path from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {WorkspaceStore} from '../src/storage.js';
let dom,fake;
try{const root=process.env.PYFORGE_TEST_NODE_MODULES;dom=root?await import(root+'/linkedom/esm/index.js'):await import('linkedom');fake=root?await import(root+'/fake-indexeddb/build/esm/index.js'):await import('fake-indexeddb');}catch{}
const runtime=process.env.PYFORGE_RUNTIME_DIR;
test('IDE DOM flow: edit/save, run real worker, search, notebook and switch project',{skip:!dom||!fake||!runtime,timeout:60000},async()=>{
 const {window}=dom.parseHTML(await readFile(new URL('../index.html',import.meta.url),'utf8'));const {document}=window;const workers=[];
 const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>{const handle=timer(fn,ms,...args);handle.unref();return handle;};
 globalThis.window=window;globalThis.document=document;globalThis.location={protocol:'http:',href:'http://localhost:8000/'};globalThis.indexedDB=new fake.IDBFactory();globalThis.CSS={escape:s=>String(s).replace(/[^\w-]/g,c=>'\\'+c)};Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});window.innerWidth=1280;
 const dialog=document.getElementById('dialog');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new window.Event('close'));};
 const oldAppend=document.head.append.bind(document.head);document.head.append=(...nodes)=>{oldAppend(...nodes);for(const n of nodes)if(n.tagName==='SCRIPT')queueMicrotask(()=>n.onerror?.());};
 globalThis.Worker=class{
  constructor(source){this.real=new NodeWorker(new URL('./worker-adapter.mjs',import.meta.url),{workerData:{source:source.href,runtime:path.resolve(runtime)+'/'}});workers.push(this.real);this.real.on('message',data=>this.onmessage?.({data}));this.real.on('error',error=>this.onerror?.(error));}
  postMessage(data){this.real.postMessage(data);}terminate(){this.real.terminate();}
 };
 const $=id=>document.getElementById(id);const click=selector=>{const el=document.querySelector(selector);assert.ok(el,'Missing '+selector);el.click();};
  const save=()=>{click('[data-menu="file"]');click('[data-action="save"]');};
 const change=(el,value)=>{el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));};
 const until=async(fn)=>{for(let i=0;i<500;i++){if(fn())return;await wait(50);}throw new Error('DOM flow timed out');};
 try{
  const {appReady}=await import('../src/app.js');await appReady;assert.match($('code-editor').querySelector('textarea').value,/from utils import summarize/);
  const firstId=$('project-select').querySelector('option').value;
  change($('code-editor').querySelector('textarea'),'print("RUN_REAL_UI")\nanswer = 42');click('#run-button');await until(()=>$('run-summary').textContent.startsWith('✓'));
  assert.match($('console-output').textContent,/RUN_REAL_UI/);assert.match($('variables-view').textContent,/answer/);
  click('[data-panel="search"]');change($('search-input'),'RUN_REAL_UI');assert.match($('search-results').textContent,/main.py:1/);
  click('[data-action="new-file"]');$('dialog').querySelector('[name=value]').value='new_module.py';click('[data-modal-submit="submit"]');await until(()=>!!document.querySelector('[data-open="new_module.py"]'));
  change($('code-editor').querySelector('textarea'),'value = 123');save();await until(()=>$('save-status').textContent.includes('Đã lưu'));
  click('[data-action="new-notebook"]');$('dialog').querySelector('[name=value]').value='analysis.ipynb';click('[data-modal-submit="submit"]');await until(()=>!!document.querySelector('[data-cell-source]'));
  change(document.querySelector('[data-cell-source]'),'a = 6\nprint(a * 7)');click('[data-run-cell]');await until(()=>document.querySelector('[data-cell-output]')?.textContent.includes('42')&&!$('run-button').disabled);
  save();await until(()=>$('save-status').textContent.includes('Đã lưu'));
  const store=await new WorkspaceStore().open();const original=await store.get(firstId);assert.equal(original.files.find(f=>f.path==='new_module.py').content,'value = 123');const nb=JSON.parse(original.files.find(f=>f.path==='analysis.ipynb').content);assert.equal(nb.cells[0].source,'a = 6\nprint(a * 7)');assert.ok(nb.cells[0].outputs.some(o=>String(o.text).includes('42')));
  click('[data-action="new-project"]');$('dialog').querySelector('[name=name]').value='second-project';click('[data-modal-submit="submit"]');await until(()=>$('workspace-label').textContent==='second-project');assert.equal($('code-editor').querySelector('textarea').value,'');assert.equal((await store.all()).length,2);store.db.close();
 }finally{for(const worker of workers)await worker.terminate();globalThis.setTimeout=timer;}
});
