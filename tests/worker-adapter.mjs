// Adapt standard Web Worker APIs to Node worker_threads for runtime tests.
import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{
 if(typeof url==='string'&&url.startsWith(workerData.runtime)&&url.endsWith('pyodide-lock.json'))return new Response(await readFile(url),{headers:{'Content-Type':'application/json'}});
 return nativeFetch(url,opts);
};
globalThis.self={postMessage:data=>parentPort.postMessage(data)};
await import(workerData.source);
parentPort.on('message',data=>{if(data.action==='init')data.args.indexURL=workerData.runtime;self.onmessage({data});});
