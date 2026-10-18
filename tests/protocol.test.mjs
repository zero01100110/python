import test from 'node:test';
import assert from 'node:assert/strict';
import {JupyterKernel} from '../src/jupyter-kernel.js';
function fixture(){const sent=[],events=[];const k=new JupyterKernel({url:'http://localhost:8888/'},'protocol',e=>events.push(e),()=>{},()=>Promise.resolve('42'));k.socket={readyState:1,send:text=>sent.push(JSON.parse(text))};return {k,sent,events};}
function receive(k,parent,type,content,id='reply'){k.receive(JSON.stringify({header:{msg_id:id,msg_type:type},parent_header:{msg_id:parent},content}));}
test('Jupyter wire protocol handles idle before execute_reply and rich output',async()=>{
 const {k,sent,events}=fixture();const done=k.execute('1 + 1');const parent=sent[0].header.msg_id;
 receive(k,parent,'stream',{name:'stdout',text:'hello\n'});receive(k,parent,'display_data',{data:{'image/png':'image-data'}});receive(k,parent,'status',{execution_state:'idle'});receive(k,parent,'execute_reply',{status:'ok',user_expressions:{}});
 assert.equal((await done).success,true);assert.equal(events[0].text,'hello\n');assert.equal(events[1].data['image/png'],'image-data');assert.equal(k.pending.size,0);
});
test('Jupyter stdin replies use request parent header; binary legacy frames decode',async()=>{
 const {k,sent}=fixture();const done=k.execute('input()');const parent=sent[0].header.msg_id;
 receive(k,parent,'input_request',{prompt:'Number: ',password:false},'input-id');await Promise.resolve();await Promise.resolve();assert.equal(sent[1].header.msg_type,'input_reply');assert.equal(sent[1].parent_header.msg_id,'input-id');assert.equal(sent[1].content.value,'42');
 const raw=new TextEncoder().encode(JSON.stringify({header:{msg_type:'execute_reply'},parent_header:{msg_id:parent},content:{status:'ok',user_expressions:{}}}));const bytes=new Uint8Array(8+raw.length);const view=new DataView(bytes.buffer);view.setUint32(0,1,false);view.setUint32(4,8,false);bytes.set(raw,8);k.receive(bytes.buffer);receive(k,parent,'status',{execution_state:'idle'});assert.equal((await done).success,true);
});
