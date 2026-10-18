const CACHE='pyforge-shell-v1';
const FILES=['./','./index.html','./styles.css','./manifest.webmanifest','./assets/favicon.svg','./README.md','./src/app.js','./src/config.js','./src/core.js','./src/storage.js','./src/zip.js','./src/editor.js','./src/render.js','./src/templates.js','./src/browser-kernel.js','./src/jupyter-kernel.js','./src/kernel.worker.js','./src/kernel-engine.js','./src/kernel-python.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pyforge-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 // Không cache Jupyter API, token, code hay file project. Chỉ cache shell tĩnh.
 const url=new URL(event.request.url);if(url.search||!FILES.some(p=>new URL(p,self.registration.scope).href===url.href))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request)));
});
