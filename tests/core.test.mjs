import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePath,newFile,newProject,validateProject,fileFromBytes,fileBytes,readNotebook,emptyNotebook,toNotebookOutput,parseRequirements,searchFiles} from '../src/core.js';
import {makeZip,readZip,crc32} from '../src/zip.js';
import {serverConfig} from '../src/jupyter-kernel.js';
import {readFile} from 'node:fs/promises';

test('relative paths and Unicode are preserved; traversal is rejected',()=>{
 assert.equal(normalizePath('src\\Việt.py'),'src/Việt.py');
 for(const path of ['../x','/etc/x','C:\\x','a//b','a/../x','a\0b','a/'])assert.throws(()=>normalizePath(path));
});
test('UTF-8 and binary files survive project serialization',()=>{
 const text=fileFromBytes('Tiếng_Việt.py',new TextEncoder().encode('print("Xin chào 🐍")'));
 const binary=fileFromBytes('model.pkl',new Uint8Array([0,255,38,18,2]));
 const copy=validateProject(JSON.parse(JSON.stringify(newProject('test',[text,binary]))));
 assert.equal(copy.files[0].encoding,'text');assert.equal(copy.files[0].content,text.content);assert.deepEqual(fileBytes(copy.files[1]),new Uint8Array([0,255,38,18,2]));
});
test('workspace rejects duplicate paths, invalid binary and file/folder collisions',()=>{
 assert.throws(()=>validateProject(newProject('x',[newFile('a.py'),newFile('a.py')])));
 assert.throws(()=>validateProject(newProject('x',[newFile('a'),newFile('a/x.py')])));
 assert.throws(()=>validateProject({...newProject('x',[newFile('a')]),folders:['a']}));
 assert.throws(()=>validateProject(newProject('x',[{path:'x.db',encoding:'base64',content:'!!!'}])));
 const p=validateProject({...newProject('safe',[newFile('main.py')]),breakpoints:{'main.py':[2,2,-1,'<img>'],other:[4]}});assert.deepEqual(p.breakpoints,{'main.py':[2]});
});
test('notebooks retain cell source and Jupyter outputs',()=>{
 const nb=emptyNotebook();nb.cells[0].source=['x = 1\n','x + 1'];const parsed=readNotebook(JSON.stringify(nb));
 assert.equal(parsed.cells[0].source,'x = 1\nx + 1');
 assert.equal(toNotebookOutput({kind:'stdout',text:'2\n'}).name,'stdout');
 assert.deepEqual(toNotebookOutput({kind:'rich',data:{'text/plain':'42'}}).data,{'text/plain':'42'});
 assert.throws(()=>readNotebook('{"nbformat":3,"cells":[]}'));
});
test('requirements accepts versions/extras and rejects command options',()=>{
 assert.deepEqual(parseRequirements('# test\nnumpy>=2\npandas==2.2.3 # note\nhttpx[http2]'),['numpy>=2','pandas==2.2.3','httpx[http2]']);
 for(const value of ['-r another.txt','--index-url https://example.com','https://example.com/x.whl'])assert.throws(()=>parseRequirements(value));
});
test('project search returns accurate file/line and supports case sensitivity',()=>{
 const files=[newFile('a.py','Hello\nhello world'),newFile('b.py','world')];
 assert.equal(searchFiles(files,'hello').length,2);assert.deepEqual(searchFiles(files,'Hello',true).map(h=>[h.path,h.line]),[['a.py',1]]);
});
test('ZIP roundtrip preserves multi-file project, Unicode and binary CRC',async()=>{
 const entries=[{path:'src/Việt.py',bytes:new TextEncoder().encode('print("Việt")')},{path:'data/model.bin',bytes:new Uint8Array([0,5,255,9])}];
 const zip=makeZip(entries);const files=await readZip(await zip.arrayBuffer());assert.deepEqual(files,entries);assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
 const corrupt=new Uint8Array(await zip.arrayBuffer());corrupt[30+new TextEncoder().encode(entries[0].path).length]^=1;
 await assert.rejects(()=>readZip(corrupt.buffer),/CRC/);
});
test('ZIP DEFLATE imports archives produced by Python zipfile',async()=>{
 const bytes=await readFile(new URL('./fixtures/deflated.zip',import.meta.url));const files=await readZip(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 assert.equal(files[0].path,'src/main.py');assert.equal(new TextDecoder().decode(files[0].bytes),'print("Xin chào")\n');
});
test('ZIP declared sizes are limited before decompression',async()=>{
 const zip=makeZip([{path:'x.py',bytes:new TextEncoder().encode('x')}]);const bytes=new Uint8Array(await zip.arrayBuffer());const view=new DataView(bytes.buffer);
 const central=30+4+1;view.setUint32(central+24,30*1024*1024,true);await assert.rejects(()=>readZip(bytes.buffer),/giới hạn/);
});
test('Jupyter base URL normalization strips token from visible URL',()=>{
 const config=serverConfig('https://host.example/jupyter/?token=abc#fragment');assert.equal(config.url,'https://host.example/jupyter/');assert.equal(config.token,'abc');
 assert.throws(()=>serverConfig('file:///x'));assert.throws(()=>serverConfig('https://name:pass@host/'));
});
