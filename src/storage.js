// IndexedDB lưu cả file nhị phân. Không lưu token hoặc khóa API.
export class WorkspaceStore {
  constructor(){this.db=null;this.tail=Promise.resolve();}
  async open(){
    this.db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('pyforge-workspaces',1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('projects',{keyPath:'id'});request.result.createObjectStore('meta');};
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Đóng tab PyForge cũ để mở cơ sở dữ liệu.'));
    });
    this.db.onversionchange=()=>this.db.close();
    return this;
  }
  transaction(store,mode,action){return new Promise((resolve,reject)=>{
    if(!this.db) return reject(new Error('Bộ nhớ chưa mở.'));
    const tx=this.db.transaction(store,mode); const request=action(tx.objectStore(store)); let value;
    request.onsuccess=()=>{value=request.result;};
    tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||request.error);tx.onabort=()=>reject(tx.error||new Error('Lưu bị hủy.'));
  });}
  all(){return this.transaction('projects','readonly',s=>s.getAll());}
  get(id){return this.transaction('projects','readonly',s=>s.get(id));}
  put(project){const snapshot=structuredClone(project);this.tail=this.tail.catch(()=>{}).then(()=>this.transaction('projects','readwrite',s=>s.put(snapshot)));return this.tail;}
  delete(id){this.tail=this.tail.catch(()=>{}).then(()=>this.transaction('projects','readwrite',s=>s.delete(id)));return this.tail;}
  getMeta(key){return this.transaction('meta','readonly',s=>s.get(key));}
  setMeta(key,value){return this.transaction('meta','readwrite',s=>s.put(value,key));}
}
