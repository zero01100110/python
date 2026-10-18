import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceStore} from '../src/storage.js';
import {newProject,newFile} from '../src/core.js';
let fake;
try{fake=process.env.PYFORGE_TEST_NODE_MODULES?await import(process.env.PYFORGE_TEST_NODE_MODULES+'/fake-indexeddb/build/esm/index.js'):await import('fake-indexeddb');}catch{}
test('IndexedDB saves snapshots, reopens workspaces and serializes edits/deletes',{skip:!fake},async()=>{
 globalThis.indexedDB=new fake.IDBFactory();const store=await new WorkspaceStore().open();const p=newProject('project',[newFile('main.py','a = 1')]);
 const first=store.put(p);p.files[0].content='a = 2';await first;assert.equal((await store.get(p.id)).files[0].content,'a = 1');
 await store.put(p);await store.setMeta('active',p.id);const reopened=await new WorkspaceStore().open();assert.equal((await reopened.get(p.id)).files[0].content,'a = 2');assert.equal(await reopened.getMeta('active'),p.id);
 const pending=store.put(p);const removal=store.delete(p.id);await Promise.all([pending,removal]);assert.equal((await reopened.all()).length,0);store.db.close();reopened.db.close();
});
