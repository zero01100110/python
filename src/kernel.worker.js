import {PythonEngine} from './kernel-engine.js';
let engine=null, chain=Promise.resolve(), requestId=null;
let streamChars=0,outputCount=0,buffer=null,lastFlush=0,flushTimer=null;
function flush(){clearTimeout(flushTimer);flushTimer=null;if(buffer){self.postMessage({type:'event',id:requestId,event:buffer});buffer=null;lastFlush=performance.now();}}
function emit(event){
  if(['stdout','stderr','system'].includes(event.kind)){
    if(streamChars>=250000)return;const text=String(event.text).slice(0,250000-streamChars);streamChars+=text.length;
    if(buffer&&buffer.kind!==event.kind)flush();if(!buffer)buffer={kind:event.kind,text:''};buffer.text+=text;
    if(buffer.text.length>=8192||performance.now()-lastFlush>35)flush();else if(!flushTimer)flushTimer=setTimeout(flush,35);return;
  }
  flush();if(['image','table','rich'].includes(event.kind)&&++outputCount>100)return;
  if(event.kind==='error')event={...event,text:String(event.text).slice(0,40000)};
  self.postMessage({type:'event',id:requestId,event});
}
self.onmessage=({data})=>{chain=chain.catch(()=>{}).then(async()=>{
  const {id,action,args}=data;requestId=id;streamChars=0;outputCount=0;
  try{
    let result;
    if(action==='init'){
      emit({kind:'system',text:'Đang tải Python WebAssembly…\n'});
      const base=args.indexURL;
      const [{loadPyodide}, catalog]=await Promise.all([
        import(base+'pyodide.mjs'),
        fetch(base+'pyodide-lock.json').then(r=>{if(!r.ok)throw new Error('Không tải được catalog thư viện.');return r.json();})
      ]);
      const py=await loadPyodide({indexURL:base});
      engine=new PythonEngine(py,emit,catalog.packages);await engine.init();
      result={catalog:catalog.packages,installed:engine.installed(),version:py.runPython('import sys;sys.version.split()[0]')};
    }else{
      if(!engine)throw new Error('Kernel chưa sẵn sàng.');
      if(action==='run')result=await engine.run(args);
      else if(action==='install')result=await engine.install(args.requirements);
      else if(action==='validate')result=engine.validate(args.code,args.filename);
      else if(action==='format')result=await engine.format(args.code);
      else if(action==='lint')result=await engine.lint(args.code,args.filename);
      else if(action==='complete')result=engine.complete(args.code,args.line,args.column,args.path);
      else if(action==='data')result=await engine.data(args);
      else if(action==='files')result=engine.collectFiles();
      else throw new Error('Kernel action không hỗ trợ: '+action);
    }
    flush();self.postMessage({type:'response',id,result});
  }catch(error){flush();self.postMessage({type:'response',id,error:error.message||String(error)});}
  finally{flush();requestId=null;}
});};
