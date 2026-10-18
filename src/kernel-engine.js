import {PY_HELPERS} from './kernel-python.js';
import {fileBytes,fileFromBytes,normalizePath} from './core.js';
const aliases={sklearn:'scikit-learn',PIL:'pillow',cv2:'opencv-python',bs4:'beautifulsoup4',yaml:'pyyaml',dateutil:'python-dateutil',skimage:'scikit-image',Crypto:'pycryptodome'};
export class PythonEngine {
  constructor(pyodide, emit, catalog={}){this.py=pyodide;this.emit=emit;this.catalog=catalog;this.previous=new Map();this.context=null;this.notebookPath=null;}
  call(name,...args){const fn=this.helpers.get(name);try{return fn(...args);}finally{fn.destroy();}}
  async callAsync(name,...args){const fn=this.helpers.get(name);let task;try{task=fn(...args);return await task;}finally{task?.destroy?.();fn.destroy();}}
  async init(){
    const FS=this.py.FS;FS.mkdirTree('/workspace');
    this.py.setStdout({batched:text=>this.emit({kind:'stdout',text:text+'\n'})});
    this.py.setStderr({batched:text=>this.emit({kind:'stderr',text:text+'\n'})});
    this.helpers=this.py.runPython('dict()');this.helpers.set('__name__','pyforge_helpers');this.helpers.set('_forge_emit_js',data=>this.emit(JSON.parse(data)));
    this.py.runPython(PY_HELPERS+'\nbuiltins.input = _forge_input',{globals:this.helpers});this.resetContext();
    await this.py.loadPackage('micropip',{messageCallback:s=>this.emit({kind:'system',text:s+'\n'})});
  }
  resetContext(){
    this.context?.destroy();this.context=this.call('_forge_new_context');
    const display=this.helpers.get('_forge_display');this.context.set('display',display);display.destroy();
    this.notebookPath=null;
  }
  syncFiles(files,folders=[]){
    const FS=this.py.FS;
    let changed=files.length!==this.previous.size;
    const removeTree=dir=>{for(const name of FS.readdir(dir)){if(name==='.'||name==='..')continue;const path=dir+'/'+name;if(FS.isDir(FS.lstat(path).mode)){removeTree(path);FS.rmdir(path);}else FS.unlink(path);}};
    const purge=dir=>{for(const name of FS.readdir(dir)){if(name==='.'||name==='..')continue;const path=dir+'/'+name;if(!FS.isDir(FS.lstat(path).mode))continue;if(name==='__pycache__'){removeTree(path);FS.rmdir(path);}else purge(path);}};purge('/workspace');
    for(const path of this.previous.keys())if(!files.some(f=>f.path===path)){try{FS.unlink('/workspace/'+path);}catch{}}
    // Remove empty directories left by renamed/deleted files.
    const cleanup=dir=>{for(const name of FS.readdir(dir)){if(name==='.'||name==='..')continue;const p=dir+'/'+name;try{if(FS.isDir(FS.lstat(p).mode)){cleanup(p);if(!FS.readdir(p).some(x=>x!=='.'&&x!=='..'))FS.rmdir(p);}}catch{}}};
    cleanup('/workspace');
    const next=new Map();
    for(const file of files){
      const path=normalizePath(file.path);const key=file.encoding+':'+file.content;next.set(path,key);
      if(this.previous.get(path)===key)continue;
      changed=true;
      const full='/workspace/'+path;FS.mkdirTree(full.slice(0,full.lastIndexOf('/')));
      try{if(FS.isDir(FS.lstat(full).mode))FS.rmdir(full);}catch{}
      FS.writeFile(full,fileBytes(file));
    }
    for(const folder of folders)FS.mkdirTree('/workspace/'+normalizePath(folder));
    this.previous=next;return changed;
  }
  collectFiles(){
    const FS=this.py.FS,files=[];let total=0;
    const walk=dir=>{
      for(const name of FS.readdir(dir)){
        if(name==='.'||name==='..'||name==='__pycache__')continue;
        const full=dir+'/'+name;let stat;try{stat=FS.lstat(full);}catch{continue;}
        if(FS.isLink(stat.mode))continue;
        if(FS.isDir(stat.mode))walk(full);
        else if(FS.isFile(stat.mode)){
          if(stat.size>25*1024*1024||total+stat.size>80*1024*1024||files.length>=2500){this.emit({kind:'stderr',text:`Không tự lưu file vượt giới hạn: ${full}\n`});continue;}
          total+=stat.size;files.push(fileFromBytes(full.replace('/workspace/',''),FS.readFile(full)));
        }
      }
    };walk('/workspace');
    this.previous=new Map(files.map(f=>[f.path,f.encoding+':'+f.content]));return files;
  }
  installed(){return JSON.parse(this.call('_forge_installed'));}
  async install(requirements){
    for(const req of requirements){
      if(typeof req!=='string'||!req.trim()||req.length>250)throw new Error('Tên gói không hợp lệ.');
      const name=req.split(/[<>=!~\[]/)[0].toLowerCase().replaceAll('_','-');
      if(this.catalog[name]&&req===name){await this.py.loadPackage(name,{messageCallback:s=>this.emit({kind:'system',text:s+'\n'})});}
      else{const pip=this.py.pyimport('micropip');try{await pip.install(req);}finally{pip.destroy();}}
    }
    return this.installed();
  }
  async imports(code,autoPip,filename){
    const sources=JSON.parse(this.call('_forge_sources',code,filename));
    for(const source of sources){
      await this.py.loadPackagesFromImports(source,{messageCallback:s=>this.emit({kind:'system',text:s+'\n'})});
      if(autoPip){const missing=JSON.parse(this.call('_forge_missing',source));for(const root of missing.slice(0,10)){const pkg=aliases[root]||root;this.emit({kind:'system',text:`Đang cài ${pkg} để import ${root}…\n`});try{await this.install([pkg]);}catch(e){this.emit({kind:'stderr',text:`Không cài được ${pkg}: ${e.message}. Python sẽ tiếp tục xử lý import theo code.\n`});}}}
    }
    if(this.py.loadedPackages.matplotlib)this.call('_forge_plot_setup');
  }
  async run({code,filename='main.py',mode='script',stdin=[],argv=[],files=[],folders=[],autoPip=true,trace=false}){
    const changed=this.syncFiles(files,folders);
    this.call('_forge_prepare',JSON.stringify(stdin),JSON.stringify(argv),filename,mode==='script'||changed);
    if(mode==='script')this.resetContext();
    else if(mode==='notebook'&&this.notebookPath!==filename){this.resetContext();this.notebookPath=filename;}
    const full='/workspace/'+normalizePath(filename);this.context.set('__file__',full);
    let success=true,error='',traceData=null;const started=performance.now();
    try{
      await this.imports(code,autoPip,full);
      if(trace)this.call('_forge_start_trace');
      const value=await this.callAsync('_forge_execute',code,this.context,full);
      if(value!==undefined&&value!==null){const text=this.call('_forge_repr',value,16000);if(text!=='None')this.emit({kind:'result',text});value?.destroy?.();}
      const exitCode=JSON.parse(this.call('_forge_exit_status'));if(exitCode!==null&&exitCode!==0){success=false;error='Python exited with status '+exitCode;this.emit({kind:'error',text:error});}
    }catch(e){success=false;error=e.message||String(e);this.emit({kind:'error',text:error});}
    finally{
      if(trace)traceData=JSON.parse(this.call('_forge_end_trace'));
      try{this.call('_forge_plot_flush');this.py.runPython('sys.stdout.flush();sys.stderr.flush()', {globals:this.helpers});}catch(e){this.emit({kind:'stderr',text:String(e)+'\n'});}
    }
    return {success,error,elapsed:performance.now()-started,variables:JSON.parse(this.call('_forge_variables',this.context)),trace:traceData,files:this.collectFiles(),installed:this.installed()};
  }
  validate(code,filename){return JSON.parse(this.call('_forge_validate',code,filename));}
  async format(code){await this.install(['autopep8']);return this.call('_forge_format',code);}
  async lint(code,filename){await this.install(['pyflakes']);return JSON.parse(this.call('_forge_lint',code,filename));}
  complete(code,line,column,path){return JSON.parse(this.call('_forge_complete',code,line,column,path));}
  async data({path,sql='',files,folders}){
    this.syncFiles(files,folders);const packages=['pandas'];
    if(/\.xlsx$/i.test(path))packages.push('openpyxl');if(/\.xls$/i.test(path))packages.push('xlrd');if(/\.parquet$/i.test(path))packages.push('fastparquet');if(/\.(db|sqlite3?)$/i.test(path))packages.push('sqlite3');
    await this.install(packages);const result=JSON.parse(this.call('_forge_data','/workspace/'+normalizePath(path),sql));
    return {result,files:this.collectFiles(),installed:this.installed()};
  }
}
